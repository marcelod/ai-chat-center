/** Brand mark (assets/brand/logo.svg, served as /icons/logo.svg). Decorative; the title next to it names the app. */
export function Logo({ size }: { size: number }) {
  return <img src="/icons/logo.svg" width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
}
