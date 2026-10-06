// Without WebGL2: show the traced SVG with flat king cobra colours.
export function showFallback(svgText: string, reason: string) {
  const box = document.querySelector<HTMLElement>('#fallback')!;
  box.innerHTML = svgText;
  box.hidden = false;
  document.querySelector<HTMLCanvasElement>('#canvas')!.hidden = true;
  const regions = box.querySelectorAll<SVGPathElement>('.region.scale, .region.head');
  regions.forEach((path) => {
    const x = Number(path.dataset.cx);
    const y = Number(path.dataset.cy);
    const band = Math.sin((y * 0.9 + x * 0.45) * 0.036) > 0.55; // the same cross bands as the shader
    path.style.fill = band ? '#8a7748' : '#2f3220';
  });
  console.warn(`Showing the static fallback: ${reason}`);
}
