import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface ChromeTheme {
  fg(color: string, text: string): string;
  bold?(text: string): string;
}

export interface TitledTopSegmentOptions {
  width: number;
  label: string;
  tail?: string;
  tailRendered?: string;
  tailPlain?: string;
  labelColor?: string;
  tailColor?: string;
  labelBold?: boolean;
}

export function formatPath(filePath: string): string {
  const home = process.env.HOME;
  if (home && filePath.startsWith(home))
    return `~${filePath.slice(home.length)}`;
  return filePath;
}

export function formatScrollInfo(above: number, below: number): string {
  let info = "";
  if (above > 0) info += `↑ ${above} more`;
  if (below > 0) info += `${info ? "  " : ""}↓ ${below} more`;
  return info;
}

export function titledTopSegment(
  theme: ChromeTheme,
  opts: TitledTopSegmentOptions,
): string {
  const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
  const width = Math.max(0, opts.width);
  if (width <= 0) return "";
  if (width <= 2) return dash(width);

  const labelColor = opts.labelColor ?? "text";
  const tailColor = opts.tailColor ?? "dim";
  const tailPlain = opts.tailPlain ?? opts.tail ?? "";
  const tailRendered =
    opts.tailRendered ??
    (opts.tail !== undefined ? theme.fg(tailColor, opts.tail) : "");
  const tailLen = visibleWidth(tailPlain);
  const canShowTail = tailLen > 0 && width - tailLen >= 14;
  const labelBudget = Math.max(0, width - (canShowTail ? tailLen + 6 : 4));
  const labelText = clipText(opts.label ?? "", labelBudget);
  const labelLen = visibleWidth(labelText);
  if (labelLen === 0) return dash(width);
  const labelStyled =
    opts.labelBold && theme.bold
      ? theme.bold(theme.fg(labelColor, labelText))
      : theme.fg(labelColor, labelText);

  if (canShowTail) {
    const fillDashes = Math.max(1, width - labelLen - tailLen - 6);
    return clipStyled(
      `${dash(1)} ${labelStyled} ${dash(fillDashes)} ${tailRendered} ${dash(1)}`,
      width,
    );
  }

  const fillDashes = Math.max(1, width - labelLen - 3);
  return clipStyled(`${dash(1)} ${labelStyled} ${dash(fillDashes)}`, width);
}

export function titledBottomSegment(
  theme: ChromeTheme,
  width: number,
  hint: string,
  focused: boolean,
): string {
  const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
  if (width <= 0) return "";
  if (!hint) return dash(width);

  const clipped = truncateToWidth(hint, Math.max(0, width - 3), "");
  const clippedLen = visibleWidth(clipped);
  if (clippedLen === 0) return dash(width);
  const hintStyled =
    focused && theme.bold
      ? theme.bold(theme.fg("accent", clipped))
      : theme.fg(focused ? "accent" : "dim", clipped);
  const fillDashes = Math.max(0, width - (clippedLen + 3));
  return `${dash(1)} ${hintStyled} ${dash(fillDashes)}`;
}

export function padRight(text: string, width: number): string {
  const clipped = visibleWidth(text) > width ? clipStyled(text, width) : text;
  const pad = Math.max(0, width - visibleWidth(clipped));
  return clipped + " ".repeat(pad);
}

export function clipText(text: string, width: number): string {
  if (width <= 0) return "";
  return Array.from(text).slice(0, width).join("");
}

export function flatRule(
  theme: ChromeTheme,
  title: string,
  width: number,
): string {
  if (width <= 0) return "";
  const dash = (n: number) => theme.fg("dim", "─".repeat(Math.max(0, n)));
  if (!title) return dash(width);
  const clipped = truncateToWidth(title, Math.max(0, width - 4), "");
  const clippedLen = visibleWidth(clipped);
  if (clippedLen === 0) return dash(width);
  const trailing = Math.max(0, width - (clippedLen + 3));
  return `${dash(1)} ${theme.fg("dim", clipped)} ${dash(trailing)}`;
}

function clipStyled(text: string, width: number): string {
  if (width <= 0) return "";
  if (!text.includes("\u001b[")) return clipText(text, width);
  return truncateToWidth(text, width, "");
}
