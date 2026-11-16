//! A saída pela placa de som (cpal): AAudio no Android, WASAPI no Windows, ALSA no Linux.
//! Abre o fluxo padrão, cria o `Sfx` com a taxa de amostragem dele e entrega os blocos do `Renderer`.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream, StreamConfig};

use crate::{Renderer, Sfx};

/// A saída de som aberta. Guarde enquanto o jogo roda: soltar fecha o som. (Não é `Send` em algumas plataformas:
/// fique com ela na thread principal; o `Sfx` que ela entrega vai para onde quiser.)
pub struct Saida {
    stream: Stream,
    sfx: Sfx,
    taxa: u32,
}

impl Saida {
    /// Abre a saída padrão. `None` se não há placa de som ou ela recusou (o jogo segue mudo).
    pub fn abrir() -> Option<Saida> {
        let host = cpal::default_host();
        let device = host.default_output_device()?;
        let config = match device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("som: sem configuração de saída: {e}");
                return None;
            }
        };
        let formato = config.sample_format();
        let cfg: StreamConfig = config.into();
        let taxa = cfg.sample_rate;
        let (sfx, rend) = Sfx::offline(taxa as f32);
        let stream = match formato {
            SampleFormat::F32 => construir::<f32>(&device, cfg, rend),
            SampleFormat::I16 => construir::<i16>(&device, cfg, rend),
            SampleFormat::U16 => construir::<u16>(&device, cfg, rend),
            SampleFormat::I32 => construir::<i32>(&device, cfg, rend),
            outro => {
                log::warn!("som: formato de amostra sem suporte: {outro}");
                return None;
            }
        };
        let stream = stream?;
        if let Err(e) = stream.play() {
            log::warn!("som: não consegui iniciar o fluxo: {e}");
            return None;
        }
        log::info!("som: {taxa} Hz, {formato:?}");
        Some(Saida { stream, sfx, taxa })
    }

    /// O controle do som para o jogo.
    pub fn sfx(&self) -> Sfx {
        self.sfx.clone()
    }

    pub fn taxa(&self) -> u32 {
        self.taxa
    }

    /// App foi para o fundo (false) ou voltou (true): para o fluxo da placa para não gastar bateria.
    pub fn ativa(&self, ativa: bool) {
        let r = if ativa { self.stream.play() } else { self.stream.pause() };
        if let Err(e) = r {
            log::warn!("som: não consegui {} o fluxo: {e}", if ativa { "retomar" } else { "pausar" });
        }
    }
}

fn construir<T>(device: &cpal::Device, cfg: StreamConfig, mut rend: Renderer) -> Option<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let canais = cfg.channels as usize;
    let mut bloco: Vec<f32> = Vec::with_capacity(4096);
    let cb = move |dados: &mut [T], _: &cpal::OutputCallbackInfo| {
        let quadros = dados.len() / canais.max(1);
        bloco.resize(quadros * 2, 0.0);
        rend.render(&mut bloco);
        for (q, fr) in dados.chunks_mut(canais.max(1)).enumerate() {
            let (l, r) = (bloco[q * 2], bloco[q * 2 + 1]);
            match fr.len() {
                1 => fr[0] = T::from_sample((l + r) * 0.5),
                _ => {
                    fr[0] = T::from_sample(l);
                    fr[1] = T::from_sample(r);
                    for s in &mut fr[2..] {
                        *s = T::from_sample(0.0);
                    }
                }
            }
        }
    };
    let erro = |e: cpal::Error| log::warn!("som: {e}");
    match device.build_output_stream(cfg, cb, erro, None) {
        Ok(s) => Some(s),
        Err(e) => {
            log::warn!("som: não consegui abrir o fluxo: {e}");
            None
        }
    }
}
