// Gráficos avançados (docs/design/GRAFICOS.md): cada ajuste do jogador por cima da qualidade, em linhas de botões.
// As linhas saem de uma tabela; o menu só desenha e devolve o novo conjunto de trocas.
import type { Prefs } from '../core/prefs';
import {
  FPS_CAP_CHOICES, MSAA_CHOICES, RESOLUTION_CHOICES, SHADOW_CHOICES, gfxCount, type GfxOverrides,
} from '../render/graphics';
import type { QualityName } from '../render/post';
import { t, type MessageKey } from '../i18n';
import { el } from './dom';

export interface GraphicsInfo {
  quality: QualityName;
  auto: boolean;
  size: [number, number];
  /** a resolução pedida passa da densidade da tela */
  capped: boolean;
}

export interface GraphicsHandlers {
  /** o jogador mudou algo: devolve o novo conjunto completo de trocas */
  onChange(next: GfxOverrides): void;
  onBack(): void;
}

interface Option {
  /** valor guardado (undefined = "Padrão": segue a qualidade) */
  value: unknown;
  label: string;
}

interface Row {
  key: keyof GfxOverrides;
  label: MessageKey;
  hint?: MessageKey;
  options: Option[];
  /** valor que vale quando a troca está em branco (para marcar o botão certo) */
  blank: unknown;
}

const num = (n: number): string => String(n).replace('.', ',');
const onOff = (): Option[] => [
  { value: true, label: t('gfx.on') },
  { value: false, label: t('gfx.off') },
];

/** as linhas, por grupo */
function groups(): { title: MessageKey; rows: Row[] }[] {
  return [
    {
      title: 'gfx.group.image',
      rows: [
        {
          key: 'resolution', label: 'gfx.resolution', hint: 'gfx.resolution.hint', blank: undefined,
          options: [
            { value: undefined, label: t('gfx.default') },
            ...RESOLUTION_CHOICES.map((r) => ({ value: r, label: r === 'native' ? t('gfx.native') : `${num(r)}×` })),
          ],
        },
        {
          key: 'msaa', label: 'gfx.msaa', hint: 'gfx.msaa.hint', blank: undefined,
          options: [
            { value: undefined, label: t('gfx.default') },
            ...MSAA_CHOICES.map((m) => ({ value: m, label: m === 0 ? t('gfx.off') : `${m}×` })),
          ],
        },
        {
          key: 'shadow', label: 'gfx.shadow', hint: 'gfx.shadow.hint', blank: undefined,
          options: [
            { value: undefined, label: t('gfx.default') },
            ...SHADOW_CHOICES.map((s) => ({
              value: s,
              label: t(s === 0 ? 'gfx.shadowOff' : s === 1024 ? 'gfx.shadowLow' : s === 2048 ? 'gfx.shadowMid' : 'gfx.shadowHigh'),
            })),
          ],
        },
      ],
    },
    {
      title: 'gfx.group.effects',
      rows: [
        { key: 'bloom', label: 'gfx.bloom', hint: 'gfx.bloom.hint', blank: undefined, options: [{ value: undefined, label: t('gfx.default') }, ...onOff()] },
        { key: 'chromatic', label: 'gfx.chromatic', blank: true, options: onOff() },
        { key: 'vignette', label: 'gfx.vignette', blank: true, options: onOff() },
        { key: 'noise', label: 'gfx.noise', blank: true, options: onOff() },
        { key: 'glow', label: 'gfx.glow', blank: true, options: onOff() },
      ],
    },
    {
      title: 'gfx.group.perf',
      rows: [
        {
          key: 'fpsCap', label: 'gfx.fpsCap', hint: 'gfx.fpsCap.hint', blank: undefined,
          options: [{ value: undefined, label: t('gfx.free') }, ...FPS_CAP_CHOICES.filter((f) => f > 0).map((f) => ({ value: f, label: String(f) }))],
        },
        { key: 'showFps', label: 'gfx.showFps', blank: false, options: onOff() },
      ],
    },
  ];
}

export class GraphicsMenu {
  private readonly root = el('#gfx');
  private current: GfxOverrides = {};
  /** valor em branco de cada linha (para marcar o botão certo) */
  private readonly blank = new Map<string, unknown>();

  constructor(private readonly h: GraphicsHandlers) {
    el('#gfx-title').textContent = t('gfx.title');
    const back = el('#gfx-back');
    back.textContent = t('gfx.back');
    back.addEventListener('click', () => h.onBack());
    const reset = el('#gfx-reset');
    reset.textContent = t('gfx.reset');
    reset.addEventListener('click', () => h.onChange({}));
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) h.onBack();
    });
    const rows = el('#gfx-rows');
    for (const g of groups()) {
      const title = document.createElement('h3');
      title.className = 'gfx-group';
      title.textContent = t(g.title);
      rows.append(title);
      for (const row of g.rows) {
        this.blank.set(row.key, row.blank);
        rows.append(this.buildRow(row));
      }
    }
  }

  private buildRow(row: Row): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'setting';
    const label = document.createElement('span');
    label.className = 'setting-label';
    label.textContent = t(row.label);
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', t(row.label));
    for (const opt of row.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opt.label;
      b.dataset.gfx = row.key;
      b.dataset.value = JSON.stringify(opt.value ?? null);
      b.addEventListener('click', () => {
        const next: Record<string, unknown> = { ...this.current };
        // voltar ao valor em branco apaga a troca (o arquivo guarda só o que o jogador mudou)
        if (opt.value === undefined || opt.value === row.blank) delete next[row.key];
        else next[row.key] = opt.value;
        this.h.onChange(next as GfxOverrides);
      });
      seg.append(b);
    }
    wrap.append(label, seg);
    if (row.hint) {
      const hint = document.createElement('span');
      hint.className = 'setting-hint';
      hint.textContent = t(row.hint);
      wrap.append(hint);
    }
    return wrap;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(prefs: Prefs, info: GraphicsInfo): void {
    this.root.hidden = false;
    this.render(prefs, info);
    el<HTMLButtonElement>('#gfx-back').focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(prefs: Prefs, info: GraphicsInfo): void {
    this.current = { ...prefs.gfx };
    const q = t(`quality.${info.quality}`);
    const base = t(info.auto ? 'gfx.infoAuto' : 'gfx.info', { quality: q, w: info.size[0], h: info.size[1] });
    const n = gfxCount(prefs.gfx);
    el('#gfx-info').textContent = [base, n ? t('gfx.custom', { n }) : '', info.capped ? t('gfx.capped') : '', n ? '' : t('gfx.hintBase')]
      .filter(Boolean)
      .join(' · ');
    const g = prefs.gfx as Record<string, unknown>;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button[data-gfx]')) {
      const key = b.dataset.gfx as string;
      const value = JSON.parse(b.dataset.value ?? 'null') as unknown;
      const now = g[key] ?? this.blank.get(key);
      b.setAttribute('aria-pressed', String((value ?? undefined) === now));
    }
  }
}
