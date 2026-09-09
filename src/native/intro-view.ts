import type { IntroDesign } from './intro-settings';

const hex = (value: number) => '#' + value.toString(16).padStart(6, '0');
function palette(color: number) {
  const channels = [16, 8, 0].map((shift) => (color >> shift) & 255);
  const tint = (offset: number[]) =>
    channels.map((value, i) => Math.max(0, Math.min(255, value + offset[i])));
  const rgb = (values: number[]) =>
    '#' + values.map((value) => value.toString(16).padStart(2, '0')).join('');
  const luminance = (values: number[]) =>
    values.reduce((sum, value, i) => {
      const s = value / 255;
      return (
        sum +
        (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
      );
    }, 0);
  const upper = tint([55, 24, 42]),
    lo = luminance(channels),
    hi = luminance(upper);
  const light = 1.05 / (Math.max(lo, hi) + 0.05),
    dark = (Math.min(lo, hi) + 0.05) / 0.05;
  const flat = Math.max(light, dark) < 4.5;
  return {
    top: flat ? hex(color) : rgb(upper),
    shadow: rgb(tint([-71, -99, -27])),
    text: flat ? (lo > 0.179 ? '#000' : '#fff') : light > dark ? '#fff' : '#000',
  };
}

/** Shared by the Studio, saved playables and every ad export. No frame-loop work. */
export function updateIntroPresentation(root: HTMLElement, design: IntroDesign) {
  root.dataset.concept = design.concept;
  root.dataset.installBar = String(design.bannerEnabled);
  root.dataset.logo = String(design.logoEnabled);
  root.querySelector<HTMLElement>('.bb-intro-hand')!.hidden = !design.handEnabled;
  const set = (key: string, value: string) => root.style.setProperty('--bb-intro-' + key, value);
  set('dim', String(design.dim / 100));
  const numeric = {
    'logo-width': design.logoWidth,
    'tagline-size': design.taglineSize,
    'headline-size': design.headlineSize,
    'button-size': design.playSize,
    'button-width': design.playWidth,
    'button-height': design.playHeight,
    'banner-height': design.bannerHeight,
    'banner-icon-size': design.iconSize,
    'banner-text-size': design.bannerTextSize,
    'banner-button-size': design.installSize,
    'install-width': design.installWidth,
    'install-height': design.installHeight,
  };
  for (const [key, value] of Object.entries(numeric)) set(key, value + 'px');
  set('text', hex(design.textColor));
  set('banner-color', hex(design.bannerColor));
  set('banner-text', palette(design.bannerColor).text);
  for (const [key, color] of [
    ['button', design.playColor],
    ['banner-button', design.installColor],
  ] as const) {
    set(key + '-color', hex(color));
    for (const [name, value] of Object.entries(palette(color))) set(key + '-' + name, value);
  }
  const fit = () => {
    if (root.hidden) return;
    const bounds = root.getBoundingClientRect(),
      scale = bounds.width / 390;
    root.style.setProperty('--bb-scale', String(scale));
    set('stage-width', bounds.width + 'px');
    const positioned = [
      '.intro-logo',
      '.intro-tagline',
      '.bb-intro-headline',
      '.bb-intro-start',
    ].map((selector) => root.querySelector<HTMLElement>(selector)!);
    for (const element of positioned) element.style.translate = 'none';
    root.style.removeProperty('--bb-intro-footer');
    set('copy-scale', '1');
    const footer = design.bannerEnabled
      ? root.querySelector('.intro-footer')!.getBoundingClientRect().height
      : 0;
    set('footer', footer + 'px');
    const top = root.querySelector('.intro-brand')!,
      headline = root.querySelector('.bb-intro-headline')!,
      content = root.querySelector('.bb-intro-content')!,
      hand = root.querySelector('.bb-intro-hand')!,
      play = root.querySelector('.intro-start')!;
    const gap = Math.max(5, scale * 10);
    for (let step = 0; step < 12; step++) {
      const header = top.getBoundingClientRect(),
        prompt = headline.getBoundingClientRect();
      const bottom = (design.handEnabled ? hand : play).getBoundingClientRect().bottom;
      const copyFits =
        design.concept === 'invitation'
          ? content.getBoundingClientRect().top >= bounds.top + bounds.height * 0.28
          : header.bottom + gap <= prompt.top;
      if (bottom <= bounds.bottom - footer - gap && copyFits) break;
      set('copy-scale', String(1 - (step + 1) * 0.04));
    }
    for (const [i, key] of (['logo', 'tagline', 'headline', 'play'] as const).entries()) {
      const element = positioned[i];
      if (element.hidden) continue;
      const rect = element.getBoundingClientRect(),
        handBox = i === 3 && design.handEnabled ? hand.getBoundingClientRect() : rect;
      const inset = Math.min(10, bounds.width * 0.025);
      const x = Math.max(
        bounds.left + inset - Math.min(rect.left, handBox.left),
        Math.min(
          bounds.right - inset - Math.max(rect.right, handBox.right + (i === 3 ? scale * 8 : 0)),
          design[`${key}X`] * scale,
        ),
      );
      const y = Math.max(
        bounds.top + inset - rect.top,
        Math.min(
          bounds.bottom - footer - inset - Math.max(rect.bottom, handBox.bottom),
          design[`${key}Y`] * scale,
        ),
      );
      element.style.translate = `${x}px ${y}px`;
    }
  };
  fit();
  // Uploaded artwork can finish decoding after its first layout.
  for (const image of Array.from(root.querySelectorAll('img'))) image.onload = fit;
}
