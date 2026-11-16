//! Vibração do aparelho (porte de `src/core/haptics.ts`, branch `web`): seis padrões curtos que o jogo dispara junto
//! com o som. No Android chama o `Vibrator` do sistema por JNI, numa thread própria (a chamada passa pelo sistema e não
//! pode atrasar o quadro). No computador não faz nada. O roteiro usa a versão que só registra o que foi pedido.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// Os mesmos seis padrões do jogo web.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Padrao {
    /// 6 ms: o golpe de picareta, o gesto na mochila
    Tick,
    /// 12 ms: bloco quebrado, recusa, primeiro aviso de ar
    Tap,
    /// 28 ms: dano, ar crítico, impacto de meteoro dentro da base
    Medium,
    /// 60-30-90 ms: asfixia, impacto de meteoro lá fora
    Heavy,
    /// 20-40-20 ms: missão, comer, renascer, recolher tudo
    Success,
    /// 120-60-200-80-300 ms: morte
    Death,
}

impl Padrao {
    /// Tempos em ms, como o `navigator.vibrate`: liga, desliga, liga…
    pub fn tempos(self) -> &'static [i64] {
        match self {
            Padrao::Tick => &[6],
            Padrao::Tap => &[12],
            Padrao::Medium => &[28],
            Padrao::Heavy => &[60, 30, 90],
            Padrao::Success => &[20, 40, 20],
            Padrao::Death => &[120, 60, 200, 80, 300],
        }
    }
}

struct Interno {
    ligada: AtomicBool,
    /// só no roteiro: o que o jogo pediu
    registro: Option<Mutex<Vec<Padrao>>>,
    /// só no Android: a fila da thread que fala com o sistema
    #[cfg(target_os = "android")]
    fila: Option<Mutex<std::sync::mpsc::Sender<Padrao>>>,
}

/// O controle da vibração que o jogo usa. Barato de copiar; sem aparelho que vibre, não faz nada.
#[derive(Clone, Default)]
pub struct Vibra {
    i: Option<Arc<Interno>>,
}

impl Vibra {
    /// Não vibra (computador, capturas).
    pub fn silenciosa() -> Self {
        Self { i: None }
    }

    /// Não vibra, mas guarda cada pedido (`pedidos`): para o roteiro conferir que a ação certa vibra.
    pub fn registrando() -> Self {
        Self {
            i: Some(Arc::new(Interno {
                ligada: AtomicBool::new(true),
                registro: Some(Mutex::new(Vec::new())),
                #[cfg(target_os = "android")]
                fila: None,
            })),
        }
    }

    /// Liga ao vibrador do Android. Em outros sistemas devolve a versão silenciosa.
    pub fn abrir() -> Self {
        #[cfg(target_os = "android")]
        {
            let (tx, rx) = std::sync::mpsc::channel::<Padrao>();
            let nome = "spacing-vibracao";
            if std::thread::Builder::new().name(nome.into()).spawn(move || android::laco(rx)).is_err() {
                log::warn!("vibração: não consegui abrir a thread");
                return Self::silenciosa();
            }
            Self {
                i: Some(Arc::new(Interno { ligada: AtomicBool::new(true), registro: None, fila: Some(Mutex::new(tx)) })),
            }
        }
        #[cfg(not(target_os = "android"))]
        Self::silenciosa()
    }

    /// A configuração **Vibração**: desligada, nada vibra.
    pub fn ativa(&self, sim: bool) {
        if let Some(i) = &self.i {
            i.ligada.store(sim, Ordering::Relaxed);
        }
    }

    pub fn vibrar(&self, p: Padrao) {
        let Some(i) = &self.i else { return };
        if !i.ligada.load(Ordering::Relaxed) {
            return;
        }
        if let Some(r) = &i.registro {
            if let Ok(mut r) = r.lock() {
                if r.len() < 4096 {
                    r.push(p);
                }
            }
        }
        #[cfg(target_os = "android")]
        if let Some(f) = &i.fila {
            if let Ok(f) = f.lock() {
                let _ = f.send(p);
            }
        }
    }

    /// Tira (e esvazia) o registro; vazio se não registra.
    pub fn pedidos(&self) -> Vec<Padrao> {
        let Some(r) = self.i.as_ref().and_then(|i| i.registro.as_ref()) else { return Vec::new() };
        r.lock().map(|mut r| std::mem::take(&mut *r)).unwrap_or_default()
    }
}

#[cfg(target_os = "android")]
mod android {
    use super::Padrao;
    use jni::objects::{JLongArray, JObject};
    use jni::{jni_sig, jni_str, Env, JavaVM};
    use std::sync::mpsc::Receiver;

    /// A thread da vibração: espera os pedidos e fala com o `Vibrator` do sistema. Qualquer erro (sem vibrador, sem
    /// permissão) só vai para o registro; o jogo segue sem vibrar.
    pub fn laco(rx: Receiver<Padrao>) {
        let ctx = ndk_context::android_context();
        if ctx.vm().is_null() || ctx.context().is_null() {
            log::warn!("vibração: sem contexto do Android");
            return;
        }
        // SAFETY: a VM e a atividade vêm do `ndk_context`, que o android-activity preenche antes do `android_main`
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) };
        let atividade = ctx.context() as jni::sys::jobject;
        let mut avisou = false;
        while let Ok(p) = rx.recv() {
            // vários pedidos juntos: só o último importa (o sistema trocaria um pelo outro de qualquer jeito)
            let p = rx.try_iter().last().unwrap_or(p);
            let r = vm.attach_current_thread(|env: &mut Env<'_>| {
                let obj = unsafe { JObject::from_raw(env, atividade) };
                vibrar(env, &obj, p)
            });
            if let Err(e) = r {
                if !avisou {
                    log::warn!("vibração: {e}");
                    avisou = true;
                }
            }
        }
    }

    fn vibrar<'j>(env: &mut Env<'j>, atividade: &JObject<'j>, p: Padrao) -> jni::errors::Result<()> {
        let nome = env.new_string("vibrator")?;
        let servico = env
            .call_method(
                atividade,
                jni_str!("getSystemService"),
                jni_sig!("(Ljava/lang/String;)Ljava/lang/Object;"),
                &[(&nome).into()],
            )?
            .l()?;
        if servico.is_null() {
            return Ok(());
        }
        // o `createWaveform` começa com uma espera: 0 ms, depois liga, desliga, liga…
        let tempos = p.tempos();
        let arr = JLongArray::new(env, tempos.len() + 1)?;
        let mut v = Vec::with_capacity(tempos.len() + 1);
        v.push(0i64);
        v.extend_from_slice(tempos);
        arr.set_region(env, 0, &v)?;
        let efeito = env
            .call_static_method(
                jni_str!("android/os/VibrationEffect"),
                jni_str!("createWaveform"),
                jni_sig!("([JI)Landroid/os/VibrationEffect;"),
                &[(&arr).into(), (-1i32).into()],
            )?
            .l()?;
        env.call_method(&servico, jni_str!("vibrate"), jni_sig!("(Landroid/os/VibrationEffect;)V"), &[(&efeito).into()])?;
        Ok(())
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn padroes_do_jogo_web() {
        assert_eq!(Padrao::Tick.tempos(), &[6]);
        assert_eq!(Padrao::Heavy.tempos(), &[60, 30, 90]);
        assert_eq!(Padrao::Death.tempos(), &[120, 60, 200, 80, 300]);
    }

    #[test]
    fn registra_e_respeita_a_configuracao() {
        let v = Vibra::registrando();
        v.vibrar(Padrao::Tap);
        v.ativa(false);
        v.vibrar(Padrao::Heavy);
        v.ativa(true);
        v.vibrar(Padrao::Success);
        assert_eq!(v.pedidos(), vec![Padrao::Tap, Padrao::Success]);
        assert!(v.pedidos().is_empty(), "o registro esvazia ao ler");
    }

    #[test]
    fn silenciosa_nao_faz_nada() {
        let v = Vibra::silenciosa();
        v.vibrar(Padrao::Death);
        assert!(v.pedidos().is_empty());
    }
}
