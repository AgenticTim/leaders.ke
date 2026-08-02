import { toast } from '$lib/stores/toast';

type TooltipArg = string | { tip: string; side?: 'top' | 'bottom' };

/** Styled hover tooltip (`.tooltip-popup` in layout.css) — the app-wide
 * replacement for title-attribute tooltips. Accepts SVG hosts too
 * (VerifiedIcon). An empty tip shows nothing, so conditional tips can pass ''. */
export function tooltip(node: HTMLElement | SVGElement, arg: TooltipArg) {
  const popup = document.createElement('div');
  popup.className = 'tooltip-popup';
  popup.setAttribute('role', 'tooltip');
  popup.style.cssText = 'position:fixed;display:none;';
  document.body.appendChild(popup);

  let tip  = typeof arg === 'string' ? arg   : arg.tip;
  let side = typeof arg === 'string' ? 'bottom' : (arg.side ?? 'bottom');

  function enter() {
    if (!tip) return;
    popup.textContent = tip;
    popup.style.display = 'block';
    const rect = node.getBoundingClientRect();
    const ph   = popup.offsetHeight;
    popup.style.left = rect.left + 'px';
    popup.style.top  = side === 'top'
      ? (rect.top - ph - 4) + 'px'
      : (rect.bottom + 4)   + 'px';
  }
  function exit() { popup.style.display = 'none'; }

  node.addEventListener('mouseenter', enter);
  node.addEventListener('mouseleave', exit);

  return {
    update(newArg: TooltipArg) {
      tip  = typeof newArg === 'string' ? newArg   : newArg.tip;
      side = typeof newArg === 'string' ? 'bottom' : (newArg.side ?? 'bottom');
      popup.textContent = tip ?? '';
    },
    destroy() {
      node.removeEventListener('mouseenter', enter);
      node.removeEventListener('mouseleave', exit);
      popup.remove();
    },
  };
}

export function copy(node: HTMLElement, text: string) {
  const dur = 1000;

  async function handleClick(e: MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    node.classList.add('success');
    setTimeout(() => node.classList.remove('success'), dur);
    toast.info(`Copied to clipboard: "${text}"`);
  }

  node.addEventListener('click', handleClick);
  return {
    update(newText: string) { text = newText; },
    destroy() { node.removeEventListener('click', handleClick); },
  };
}

export function disableForSeconds(node: HTMLElement, seconds: number) {
  function handleClick() {
    (node as HTMLButtonElement).disabled = true;
    setTimeout(() => { (node as HTMLButtonElement).disabled = false; }, Number(seconds) * 1000);
  }

  node.addEventListener('click', handleClick);
  return {
    update(newSeconds: number) { seconds = newSeconds; },
    destroy() { node.removeEventListener('click', handleClick); },
  };
}