// Icons from the Figma v4 frames, drawn with currentColor so they take the text colour of their parent.
type P = { className?: string };

export function Logo({ className }: P) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <path d="M 11.75 3.10 Q 14.00 1.80 16.25 3.10 L 22.31 6.60 Q 24.57 7.90 24.57 10.50 L 24.57 17.50 Q 24.57 20.10 22.31 21.40 L 16.25 24.90 Q 14.00 26.20 11.75 24.90 L 5.69 21.40 Q 3.43 20.10 3.43 17.50 L 3.43 10.50 Q 3.43 7.90 5.69 6.60 Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M 14.00 14.00 L 23.09 8.75 M 14.00 14.00 L 4.91 8.75 M 14.00 14.00 L 14.00 24.49" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon({ className }: P) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2.66667V10M10.6667 7.33333L8 10L5.33333 7.33333M3.33333 12.6667H12.6667" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Chevron({ className }: P) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3.5 7.3L5.7 9.5L10.5 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ResetIcon({ className }: P) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M2.16667 6.5C2.16548 7.49767 2.50859 8.46519 3.13807 9.23922C3.76754 10.0132 4.64482 10.5464 5.62179 10.7485C6.59875 10.9507 7.61557 10.8096 8.50056 10.349C9.38554 9.88844 10.0845 9.13658 10.4794 8.2204C10.8743 7.30421 10.941 6.27982 10.6682 5.32017C10.3954 4.36053 9.79976 3.52441 8.98194 2.95299C8.16412 2.38157 7.17418 2.10984 6.17924 2.18369C5.18431 2.25754 4.24533 2.67243 3.52083 3.35833" stroke="currentColor" strokeWidth="1.19167" strokeLinecap="round" />
      <path d="M2.16667 2.16667V4.875H4.875" stroke="currentColor" strokeWidth="1.19167" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** ↺ (dir = -1) or ↻ (dir = 1) */
export function RotateIcon({ dir, className }: P & { dir: 1 | -1 }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={dir === 1 ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M2.33333 7C2.33206 8.07442 2.70156 9.11636 3.37946 9.94993C4.05735 10.7835 5.00211 11.3576 6.05423 11.5754C7.10635 11.7931 8.20138 11.6411 9.15444 11.1451C10.1075 10.6491 10.8602 9.8394 11.2855 8.85273C11.7108 7.86607 11.7826 6.76288 11.4888 5.72942C11.195 4.69595 10.5536 3.79552 9.67286 3.18014C8.79213 2.56476 7.72604 2.27214 6.65457 2.35167C5.5831 2.43119 4.57189 2.87801 3.79167 3.61667" stroke="currentColor" strokeWidth="1.28333" strokeLinecap="round" />
      <path d="M2.33333 2.33333V5.25H5.25" stroke="currentColor" strokeWidth="1.28333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CubeIcon({ className }: P) {
  return (
    <svg className={className} width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden>
      <path d="M8 17.5V40.5L28 52L48 40.5V17.5L28 6L8 17.5ZM48 17.5L28 29M28 52V29M8 17.5L28 29" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function MinusIcon({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7H11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7H11M7 3V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fit: 100 % and centred */
export function FitIcon({ className }: P) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 5V2H5M11 2H14V5M14 11V14H11M5 14H2V11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UndoIcon({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 3.5L2.5 6L5 8.5M2.5 6H8.5C10.1569 6 11.5 7.34315 11.5 9C11.5 10.6569 10.1569 12 8.5 12H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RedoIcon({ className }: P) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ transform: 'scaleX(-1)' }}>
      <path d="M5 3.5L2.5 6L5 8.5M2.5 6H8.5C10.1569 6 11.5 7.34315 11.5 9C11.5 10.6569 10.1569 12 8.5 12H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SunIcon({ className }: P) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M8.9375 6.5C8.9375 7.84619 7.84619 8.9375 6.5 8.9375C5.15381 8.9375 4.0625 7.84619 4.0625 6.5C4.0625 5.15381 5.15381 4.0625 6.5 4.0625C7.84619 4.0625 8.9375 5.15381 8.9375 6.5Z" stroke="currentColor" strokeWidth="1.08333" />
      <path d="M6.5 1.08333V2.4375M6.5 10.5625V11.9167M1.08333 6.5H2.4375M10.5625 6.5H11.9167M2.65417 2.65417L3.62917 3.62917M9.37083 9.37083L10.3458 10.3458M2.65417 10.3458L3.62917 9.37083M9.37083 3.62917L10.3458 2.65417" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" />
    </svg>
  );
}

export function MoonIcon({ className }: P) {
  return (
    <svg className={className} width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <path d="M10.8333 7.85417C10.0377 8.19416 9.15844 8.28816 8.30888 8.12408C7.45931 7.96 6.67833 7.54534 6.06649 6.9335C5.45466 6.32167 5.04 5.54069 4.87592 4.69112C4.71184 3.84156 4.80584 2.96233 5.14583 2.16667C4.49428 2.44508 3.92093 2.87901 3.47602 3.43045C3.03111 3.98189 2.7282 4.63402 2.59384 5.32971C2.45947 6.0254 2.49775 6.74342 2.70531 7.42088C2.91288 8.09834 3.2834 8.71457 3.78441 9.21559C4.28543 9.7166 4.90166 10.0871 5.57912 10.2947C6.25658 10.5023 6.9746 10.5405 7.67029 10.4062C8.36598 10.2718 9.01811 9.96889 9.56955 9.52398C10.121 9.07907 10.5549 8.50572 10.8333 7.85417Z" stroke="currentColor" strokeWidth="1.08333" strokeLinejoin="round" />
    </svg>
  );
}

const tool = (d: string) =>
  function ToolIcon({ className }: P) {
    return (
      <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d={d} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };
const CIRCLE = 'M7 1.5C5.54 1.5 4.14 2.08 3.11 3.11C2.08 4.14 1.5 5.54 1.5 7C1.5 8.46 2.08 9.86 3.11 10.89C4.14 11.92 5.54 12.5 7 12.5C8.46 12.5 9.86 11.92 10.89 10.89C11.92 9.86 12.5 8.46 12.5 7C12.5 5.54 11.92 4.14 10.89 3.11C9.86 2.08 8.46 1.5 7 1.5Z';
export const SelectIcon = tool('M3 2L11 7L7 8L5.5 12L3 2Z');
export const LinearIcon = tool('M2 4V10M12 4V10M2 7H12');
export const DiameterIcon = tool('M3.2 10.8L10.8 3.2M' + CIRCLE.slice(1));
export const RadiusIcon = tool('M7 7L11 3M' + CIRCLE.slice(1));
export const RemoveIcon = tool('M4 4L10 10M10 4L4 10');

/** Show / hide the left panel */
export const PanelIcon = tool(
  'M5.5 2V12M3.5 2H10.5C10.9 2 11.28 2.16 11.56 2.44C11.84 2.72 12 3.1 12 3.5V10.5C12 10.9 11.84 11.28 11.56 11.56C11.28 11.84 10.9 12 10.5 12H3.5C3.1 12 2.72 11.84 2.44 11.56C2.16 11.28 2 10.9 2 10.5V3.5C2 3.1 2.16 2.72 2.44 2.44C2.72 2.16 3.1 2 3.5 2Z',
);

export function PanelButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-[30px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-surface text-fg-2 hover:bg-surface-hover hover:text-fg"
    >
      <PanelIcon />
    </button>
  );
}
