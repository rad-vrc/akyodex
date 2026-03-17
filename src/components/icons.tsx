/**
 * Inline SVG Icon Components
 *
 * Replaces FontAwesome CDN (~60KB CSS + ~900KB font files) with
 * tree-shakeable inline SVG components. Only icons actually used
 * are included in the bundle.
 *
 * SVG paths sourced from FontAwesome 6 Free (solid).
 * License: CC BY 4.0 / SIL OFL 1.1
 * https://fontawesome.com/license/free
 */

import type { SVGProps } from "react";

/**
 * Base properties for SVG Icon components
 */
interface IconProps extends SVGProps<SVGSVGElement> {
  /**
   * Icon size class (Tailwind CSS classes like "w-4 h-4" or "w-5 h-5").
   * Defaults to "w-4 h-4" in the wrapper component.
   */
  size?: string;
}

/**
 * Common Icon Wrapper Component
 * Provides standard SVG structure, Tailwind sizing, and accessibility defaults (aria-hidden).
 *
 * @param props - Component properties including size and children (paths)
 * @returns Accessible SVG element
 */
function Icon({
  size = "w-4 h-4",
  className = "",
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="currentColor"
      className={`inline-block ${size} ${className}`}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

// ═══════════════════════════════════════
// Public page icons
// ═══════════════════════════════════════

/**
 * Card view icon
 * Renders a two-card filled stack while preserving currentColor styling.
 * The back card uses reduced opacity so both cards remain distinguishable.
 * @param props - Icon properties
 */
export function IconGrid({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="40 32 348 304" {...props}>
      <rect
        x="216"
        y="116"
        width="160"
        height="216"
        rx="28"
        fill="currentColor"
        opacity="0.35"
      />
      <rect
        x="96"
        y="76"
        width="160"
        height="216"
        rx="28"
        fill="currentColor"
        transform="rotate(-13 176 184)"
      />
    </Icon>
  );
}

/**
 * List view icon (list equivalent)
 * @param props - Icon properties
 */
export function IconList({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M40 48C26.7 48 16 58.7 16 72v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V72c0-13.3-10.7-24-24-24H40zM192 64c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zm0 160c-17.7 0-32 14.3-32 32s14.3 32 32 32H480c17.7 0 32-14.3 32-32s-14.3-32-32-32H192zM16 232v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V232c0-13.3-10.7-24-24-24H40c-13.3 0-24 10.7-24 24zM40 368c-13.3 0-24 10.7-24 24v48c0 13.3 10.7 24 24 24H88c13.3 0 24-10.7 24-24V392c0-13.3-10.7-24-24-24H40z" />
    </Icon>
  );
}

/**
 * Settings gear icon (cog equivalent)
 * @param props - Icon properties
 */
export function IconCog({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-5.9 7.2-15.7 9.6-24.5 6.8l-55.7-17.7c-13.4 10.3-28.2 18.9-44 25.4l-12.5 57.1c-2 9.1-9 16.3-18.2 17.8c-13.8 2.3-28 3.5-42.5 3.5s-28.7-1.2-42.5-3.5c-9.2-1.5-16.2-8.7-18.2-17.8l-12.5-57.1c-15.8-6.5-30.6-15.1-44-25.4L83.1 425.9c-8.8 2.8-18.6 .3-24.5-6.8c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C64.6 273.1 64 264.6 64 256s.6-17.1 1.7-25.4L22.4 191.2c-6.9-6.2-9.6-15.9-6.4-24.6c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c5.9-7.2 15.7-9.6 24.5-6.8l55.7 17.7c13.4-10.3 28.2-18.9 44-25.4l12.5-57.1c2-9.1 9-16.3 18.2-17.8C227.3 1.2 241.5 0 256 0s28.7 1.2 42.5 3.5c9.2 1.5 16.2 8.7 18.2 17.8l12.5 57.1c15.8 6.5 30.6 15.1 44 25.4l55.7-17.7c8.8-2.8 18.6-.3 24.5 6.8c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160z" />
    </Icon>
  );
}

/**
 * Heart icon for favorites (solid / filled)
 * @param props - Icon properties
 */
export function IconHeart({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z" />
    </Icon>
  );
}

/**
 * Heart outline icon for unfavorited state (regular / outline)
 * FontAwesome 6 Free – Regular (fa-heart)
 * @param props - Icon properties
 */
export function IconHeartOutline({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M225.8 468.2l-2.5-2.3L48.1 303.2C17.4 274.7 0 234.7 0 192.8v-3.3c0-70.4 50-130.8 119.2-144C158.6 37.9 198.9 47 231 69.6c9 6.4 17.4 13.8 25 22.1c4.2-4.6 8.7-8.9 13.5-12.7c6.3-5.1 13.3-9.5 20.7-13.2C315.5 53.2 343.1 44.8 372.2 45.5c67 1.6 123.7 55.6 131.4 122.5c.9 7.5 1.4 15.2 1.4 23v1.8c0 41.9-17.4 81.9-48.1 110.4L282.7 465.9l-2.5 2.3c-8.2 7.6-19 11.9-30.2 11.9s-22-4.2-30.2-11.9zM239.1 145c-.4-.3-.7-.7-1-1.1l-17.8-20c0 0 0 0 0 0c-23.1-25.9-58-37.7-92-31.2C81.6 101.5 48 142.1 48 189.5v3.3c0 28.5 11.9 55.8 32.8 75.2L256 430.7 431.2 268c20.9-19.4 32.8-46.7 32.8-75.2v-1.8c0-6-.4-11.9-1.2-17.7C457 125.2 414.6 93.4 372.8 93.5c-24.8 0-47.3 8.9-64.6 21.8c-11.4 8.5-21.1 19.5-28.4 32.3l-8.7 15.3-8.7-15.3c-5.7-10-12.8-18.8-21.3-26.5z" />
    </Icon>
  );
}

/**
 * Dice icon for random selection
 * @param props - Icon properties
 */
export function IconDice({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 640 512" {...props}>
      <path d="M274.9 34.3c-28.1-28.1-73.7-28.1-101.8 0L34.3 173.1c-28.1 28.1-28.1 73.7 0 101.8L173.1 413.7c28.1 28.1 73.7 28.1 101.8 0L413.7 274.9c28.1-28.1 28.1-73.7 0-101.8L274.9 34.3zM200 224a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zM96 200a24 24 0 1 1 0 48 24 24 0 1 1 0-48zM224 376a24 24 0 1 1 0-48 24 24 0 1 1 0 48zM352 200a24 24 0 1 1 0 48 24 24 0 1 1 0-48zM224 120a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm96 328c0 35.3 28.7 64 64 64H576c35.3 0 64-28.7 64-64V256c0-35.3-28.7-64-64-64H461.7c11.6 36 3.1 77-25.4 105.5L320 413.8V448zm160-120a24 24 0 1 1 0 48 24 24 0 1 1 0-48z" />
    </Icon>
  );
}

/**
 * Info circle icon for details
 * @param props - Icon properties
 */
export function IconInfoCircle({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" />
    </Icon>
  );
}

/**
 * External link icon
 * @param props - Icon properties
 */
export function IconExternalLink({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32h82.7L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3V192c0 17.7 14.3 32 32 32s32-14.3 32-32V32c0-17.7-14.3-32-32-32H320zM80 32C35.8 32 0 67.8 0 112V432c0 44.2 35.8 80 80 80H400c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32 14.3-32 32V432c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16H192c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z" />
    </Icon>
  );
}

/**
 * Tag icon (tag equivalent)
 * @param props - Icon properties
 */
export function IconTag({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 448 512" {...props}>
      <path d="M0 80V229.5c0 17 6.7 33.3 18.7 45.3l176 176c25 25 65.5 25 90.5 0L418.7 317.3c25-25 25-65.5 0-90.5l-176-176c-12-12-28.3-18.7-45.3-18.7H48C21.5 32 0 53.5 0 80zm112 32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z" />
    </Icon>
  );
}

/**
 * User profile icon
 * @param props - Icon properties
 */
export function IconUser({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 448 512" {...props}>
      <path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z" />
    </Icon>
  );
}

/**
 * Sparkles icon for special variants
 * @param props - Icon properties
 */
export function IconSparkles({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 576 512" {...props}>
      <path d="M234.7 42.7L197 56.8c-3 1.1-5 4-5 7.2s2 6.1 5 7.2l37.7 14.1L248.8 123c1.1 3 4 5 7.2 5s6.1-2 7.2-5l14.1-37.7L315 71.2c3-1.1 5-4 5-7.2s-2-6.1-5-7.2L277.3 42.7 263.2 5c-1.1-3-4-5-7.2-5s-6.1 2-7.2 5L234.7 42.7zM46.1 395.4c-18.7 18.7-18.7 49.1 0 67.9l34.6 34.6c18.7 18.7 49.1 18.7 67.9 0L529.9 116.5c18.7-18.7 18.7-49.1 0-67.9L495.3 14c-18.7-18.7-49.1-18.7-67.9 0L46.1 395.4zM484.6 82.6l-105 105-23.3-23.3 105-105 23.3 23.3zM7.5 117.2C3 118.9 0 123.2 0 128s3 9.1 7.5 10.8L64 160l21.2 56.5c1.7 4.5 6 7.5 10.8 7.5s9.1-3 10.8-7.5L128 160l56.5-21.2c4.5-1.7 7.5-6 7.5-10.8s-3-9.1-7.5-10.8L128 96 106.8 39.5C105.1 35 100.8 32 96 32s-9.1 3-10.8 7.5L64 96 7.5 117.2zm352 256c-4.5 1.7-7.5 6-7.5 10.8s3 9.1 7.5 10.8L416 416l21.2 56.5c1.7 4.5 6 7.5 10.8 7.5s9.1-3 10.8-7.5L480 416l56.5-21.2c4.5-1.7 7.5-6 7.5-10.8s-3-9.1-7.5-10.8L480 352l-21.2-56.5c-1.7-4.5-6-7.5-10.8-7.5s-9.1 3-10.8 7.5L416 352l-56.5 21.2z" />
    </Icon>
  );
}

/** VRChat logo (Official SimpleIcons data) */
export function IconVRChat({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="-1 -1 26 26" {...props}>
      <path d="M22.732 6.767H1.268A1.27 1.27 0 0 0 0 8.035v5.296c0 .7.57 1.268 1.268 1.268h18.594l1.725 2.22c.215.275.443.415.68.415.153 0 .296-.06.403-.167.128-.129.193-.308.193-.536l-.002-1.939A1.27 1.27 0 0 0 24 13.331V8.035c0-.7-.569-1.269-1.268-1.269Zm.8 6.564a.8.8 0 0 1-.8.801h-.34v.031l.004 2.371c0 .155-.05.233-.129.233s-.19-.079-.31-.235l-1.866-2.4H1.268a.8.8 0 0 1-.8-.8V8.064a.8.8 0 0 1 .8-.8h21.464a.8.8 0 0 1 .8.8v5.266ZM4.444 8.573c-.127 0-.225.041-.254.15l-.877 3.129-.883-3.128c-.03-.11-.127-.15-.254-.15-.202 0-.473.126-.473.311 0 .012.005.035.011.058l1.114 3.63c.058.173.265.254.485.254s.433-.08.484-.254l1.109-3.63c.005-.023.011-.04.011-.058 0-.179-.27-.312-.473-.312Zm2.925 2.36c.433-.132.757-.49.757-1.153 0-.918-.612-1.207-1.368-1.207H5.614a.234.234 0 0 0-.242.231v3.752c0 .156.184.237.374.237s.376-.081.376-.237V11.05h.484l.82 1.593c.058.115.156.179.26.179.219 0 .467-.203.467-.393a.155.155 0 0 0-.028-.092l-.756-1.403Zm-.61-.473h-.636V9.231h.635c.375 0 .618.162.618.618s-.242.612-.618.612Zm10.056.826h1.004l-.502-1.772-.502 1.772Zm4.684-3.095H9.366a.8.8 0 0 0-.8.8v3.383a.8.8 0 0 0 .8.8h12.132a.8.8 0 0 0 .8-.8V8.992a.8.8 0 0 0-.8-.801Zm-10.946 3.977c.525 0 .571-.374.589-.617.011-.179.173-.236.369-.236.26 0 .38.075.38.369 0 .698-.57 1.142-1.379 1.142-.727 0-1.327-.357-1.327-1.322v-1.61c0-.963.606-1.322 1.333-1.322.802 0 1.374.427 1.374 1.097 0 .3-.121.37-.375.37-.214 0-.37-.064-.375-.238-.012-.178-.052-.57-.6-.57-.387 0-.606.213-.606.663v1.61c0 .45.219.664.617.664Zm4.703.388c0 .156-.19.237-.375.237s-.375-.081-.375-.237V10.9h-1.299v1.656c0 .156-.19.237-.375.237s-.375-.081-.375-.237V8.804c0-.161.185-.23.375-.23s.375.069.375.23v1.507h1.299V8.804c0-.161.185-.23.375-.23s.375.069.375.23v3.752Zm3.198.236c-.127 0-.225-.04-.254-.15l-.22-.768h-1.322l-.219.768c-.029.11-.127.15-.254.15-.202 0-.473-.127-.473-.311 0-.012.006-.035.012-.058l1.114-3.63c.051-.173.265-.254.478-.254s.433.08.485.254l1.114 3.63c.006.023.012.04.012.058 0 .179-.272.311-.473.311Zm2.989-3.543h-.843v3.306c0 .156-.19.237-.375.237s-.375-.081-.375-.237V9.25h-.848c-.15 0-.237-.157-.237-.34 0-.162.075-.336.237-.336h2.44c.162 0 .238.173.238.335 0 .18-.087.34-.237.34Z" />
    </Icon>
  );
}

/**
 * Gift icon
 * @param props - Icon properties
 */
export function IconGift({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M190.5 68.8L225.3 128l-1.3 0-72 0c-22.1 0-40-17.9-40-40s17.9-40 40-40l2.2 0c14.9 0 28.8 7.9 36.3 20.8zM64 88c0 14.4 3.5 28 9.6 40L32 128c-17.7 0-32 14.3-32 32l0 64c0 17.7 14.3 32 32 32l448 0c17.7 0 32-14.3 32-32l0-64c0-17.7-14.3-32-32-32l-41.6 0c6.1-12 9.6-25.6 9.6-40c0-48.6-39.4-88-88-88l-2.2 0c-31.9 0-61.5 16.9-77.7 44.4L256 85.5l-24.1-41C215.7 16.9 186.1 0 154.2 0L152 0C103.4 0 64 39.4 64 88zm336 0c0 22.1-17.9 40-40 40l-72 0-1.3 0 34.8-59.2C329.1 55.9 342.9 48 357.8 48l2.2 0c22.1 0 40 17.9 40 40zM32 288l0 176c0 26.5 21.5 48 48 48l144 0 0-224L32 288zM288 512l144 0c26.5 0 48-21.5 48-48l0-176-192 0 0 224z" />
    </Icon>
  );
}

/**
 * Sort ascending icon
 * @param props - Icon properties
 */
export function IconSortAsc({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 576 512" {...props}>
      <path d="M160 64c-17.7 0-32 14.3-32 32V348.7L86.6 307.3c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l96 96c12.5 12.5 32.8 12.5 45.3 0l96-96c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 348.7V96c0-17.7-14.3-32-32-32z" />
      <path d="M336 112c0-8.8 7.2-16 16-16H432c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16zm0 112c0-8.8 7.2-16 16-16H496c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16zm0 112c0-8.8 7.2-16 16-16H544c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16z" />
    </Icon>
  );
}

/**
 * Sort descending icon
 * @param props - Icon properties
 */
export function IconSortDesc({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 576 512" {...props}>
      <path d="M160 448c17.7 0 32-14.3 32-32V163.3l41.4 41.4c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-96-96c-12.5-12.5-32.8-12.5-45.3 0l-96 96c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L128 163.3V416c0 17.7 14.3 32 32 32z" />
      <path d="M336 112c0-8.8 7.2-16 16-16H544c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16zm0 112c0-8.8 7.2-16 16-16H496c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16zm0 112c0-8.8 7.2-16 16-16H432c8.8 0 16 7.2 16 16s-7.2 16-16 16H352c-8.8 0-16-7.2-16-16z" />
    </Icon>
  );
}

// ═══════════════════════════════════════
// Admin page icons
// ═══════════════════════════════════════

/**
 * Shield icon for admin/security
 * @param props - Icon properties
 */
export function IconShield({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 0c4.6 0 9.2 1 13.4 2.9L457.7 82.8c22 9.3 38.4 31 38.3 57.2c-.5 99.2-41.3 280.7-213.6 363.2c-16.7 8-36.1 8-52.8 0C57.3 420.7 16.5 239.2 16 140c-.1-26.2 16.3-47.9 38.3-57.2L242.7 2.9C246.8 1 251.4 0 256 0z" />
    </Icon>
  );
}

/**
 * Home icon
 * @param props - Icon properties
 */
export function IconHome({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 576 512" {...props}>
      <path d="M575.8 255.5c0 18-15 32.1-32 32.1h-32l.7 160.2c0 2.7-.2 5.4-.5 8.1V472c0 22.1-17.9 40-40 40H456c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1H416 392c-22.1 0-40-17.9-40-40V376c0-9.8-8-17.8-17.8-17.8H241.8c-9.8 0-17.8 8-17.8 17.8v96c0 22.1-17.9 40-40 40H160 136c-1.4 0-2.8 0-4.2-.1c-1.1 .1-2.2 .1-3.3 .1H96c-22.1 0-40-17.9-40-40V360c0-.9 0-1.9 .1-2.8V287.6H32c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z" />
    </Icon>
  );
}

/**
 * Sign out icon
 * @param props - Icon properties
 */
export function IconSignOut({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M377.9 105.9L500.7 228.7c7.2 7.2 11.3 17.1 11.3 27.3s-4.1 20.1-11.3 27.3L377.9 406.1c-6.4 6.4-15 9.9-24 9.9c-18.7 0-33.9-15.2-33.9-33.9l0-62.1-128 0c-17.7 0-32-14.3-32-32l0-64c0-17.7 14.3-32 32-32l128 0 0-62.1c0-18.7 15.2-33.9 33.9-33.9c9 0 17.6 3.6 24 9.9zM160 96L96 96c-17.7 0-32 14.3-32 32l0 256c0 17.7 14.3 32 32 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-64 0c-53 0-96-43-96-96L0 128C0 75 43 32 96 32l64 0c17.7 0 32 14.3 32 32s-14.3 32-32 32z" />
    </Icon>
  );
}

/**
 * Lock icon for passwords/private content
 * @param props - Icon properties
 */
export function IconLock({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 448 512" {...props}>
      <path d="M144 144v48H304V144c0-44.2-35.8-80-80-80s-80 35.8-80 80zM80 192V144C80 64.5 144.5 0 224 0s144 64.5 144 144v48h16c35.3 0 64 28.7 64 64V448c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V256c0-35.3 28.7-64 64-64H80z" />
    </Icon>
  );
}

/**
 * Sign in icon
 * @param props - Icon properties
 */
export function IconSignIn({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M352 96l64 0c17.7 0 32 14.3 32 32l0 256c0 17.7-14.3 32-32 32l-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l64 0c53 0 96-43 96-96l0-256c0-53-43-96-96-96l-64 0c-17.7 0-32 14.3-32 32s14.3 32 32 32zm-9.4 182.6c12.5-12.5 12.5-32.8 0-45.3l-128-128c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L242.7 224 32 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l210.7 0-73.4 73.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0l128-128z" />
    </Icon>
  );
}

/**
 * Exclamation circle icon for warnings
 * @param props - Icon properties
 */
export function IconExclamationCircle({
  size,
  className,
  ...props
}: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zm0-384c13.3 0 24 10.7 24 24V264c0 13.3-10.7 24-24 24s-24-10.7-24-24V152c0-13.3 10.7-24 24-24zM224 352a32 32 0 1 1 64 0 32 32 0 1 1 -64 0z" />
    </Icon>
  );
}

/**
 * Plus circle icon
 * @param props - Icon properties
 */
export function IconPlusCircle({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM232 344V280H168c-13.3 0-24-10.7-24-24s10.7-24 24-24h64V168c0-13.3 10.7-24 24-24s24 10.7 24 24v64h64c13.3 0 24 10.7 24 24s-10.7 24-24 24H280v64c0 13.3-10.7 24-24 24s-24-10.7-24-24z" />
    </Icon>
  );
}

/**
 * Edit icon
 * @param props - Icon properties
 */
export function IconEdit({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0L362.3 51.7l97.9 97.9 30.1-30.1c21.9-21.9 21.9-57.3 0-79.2L471.6 21.7zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s16 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5L437.7 149.7 339.8 51.8 172.4 241.7z" />
    </Icon>
  );
}

/**
 * IconTools currently delegates to IconCog intentionally.
 * We use the gear (IconCog) because it stays legible in small admin tab buttons,
 * even though this diverges from a wrench graphic. If a true wrench icon is needed
 * later, replace this delegation with a dedicated IconTools SVG path.
 */
export function IconTools({ size, className, ...props }: IconProps) {
  // Reuse gear icon for better legibility at small sizes in admin tabs.
  return <IconCog size={size} className={className} {...props} />;
}

/**
 * Multiple tags icon
 * @param props - Icon properties
 */
export function IconTags({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M345 39.1L472.8 168.4c52.4 53 52.4 138.2 0 191.2L360.8 472.9c-9.3 9.4-24.5 9.5-33.9 .2s-9.5-24.5-.2-33.9L438.6 325.9c33.9-34.3 33.9-89.4 0-123.7L310.9 72.9c-9.3-9.4-9.2-24.6 .2-33.9s24.6-9.2 33.9 .2zM0 229.5V80C0 53.5 21.5 32 48 32H197.5c17 0 33.3 6.7 45.3 18.7l168 168c25 25 25 65.5 0 90.5L277.3 442.7c-25 25-65.5 25-90.5 0l-168-168C6.7 262.7 0 246.5 0 229.5zM112 112a32 32 0 1 0 0 64 32 32 0 1 0 0-64z" />
    </Icon>
  );
}

/**
 * Close/X icon
 * @param props - Icon properties
 */
export function IconClose({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 384 512" {...props}>
      <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" />
    </Icon>
  );
}

/**
 * Search icon
 * @param props - Icon properties
 */
export function IconSearch({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z" />
    </Icon>
  );
}

/**
 * Check circle icon for success
 * @param props - Icon properties
 */
export function IconCheckCircle({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369.2 198.6L232 335.8 142.8 246.6c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l44 44L323.8 153.4c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3z" />
    </Icon>
  );
}

/**
 * Simple circle icon
 * @param props - Icon properties
 */
export function IconCircle({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512z" />
    </Icon>
  );
}

/**
 * Cloud upload icon
 * @param props - Icon properties
 */
export function IconCloudUpload({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 640 512" {...props}>
      <path d="M144 480C64.5 480 0 415.5 0 336c0-62.8 40.2-116.2 96.2-135.9c-.1-2.7-.2-5.4-.2-8.1c0-88.4 71.6-160 160-160c59.3 0 111 32.2 138.7 80.2C409.9 102 428.3 96 448 96c53 0 96 43 96 96c0 12.2-2.3 23.8-6.4 34.6C596 238.4 640 290.1 640 352c0 70.7-57.3 128-128 128H144zm79-217c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l39-39V392c0 13.3 10.7 24 24 24s24-10.7 24-24V257.9l39 39c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-80-80c-9.4-9.4-24.6-9.4-33.9 0l-80 80z" />
    </Icon>
  );
}

/**
 * Cloud download icon
 * @param props - Icon properties
 */
export function IconCloudDownload({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 640 512" {...props}>
      <path d="M144 480C64.5 480 0 415.5 0 336c0-62.8 40.2-116.2 96.2-135.9c-.1-2.7-.2-5.4-.2-8.1c0-88.4 71.6-160 160-160c59.3 0 111 32.2 138.7 80.2C409.9 102 428.3 96 448 96c53 0 96 43 96 96c0 12.2-2.3 23.8-6.4 34.6C596 238.4 640 290.1 640 352c0 70.7-57.3 128-128 128H144zm80.8-262.8c-9.4-9.4-24.6-9.4-33.9 0s-9.4 24.6 0 33.9l80 80c9.4 9.4 24.6 9.4 33.9 0l80-80c9.4-9.4 9.4-24.6 0-33.9s-24.6-9.4-33.9 0L344 254.1V152c0-13.3-10.7-24-24-24s-24 10.7-24 24V254.1l-39-39z" />
    </Icon>
  );
}

/**
 * Crop icon
 * @param props - Icon properties
 */
export function IconCrop({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M448 109.3l54.6-54.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L402.7 64H160c-35.3 0-64 28.7-64 64v242.7L41.4 425.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L141.3 416H384c35.3 0 64-28.7 64-64V109.3zM384 352H141.3L384 109.3V352z" />
    </Icon>
  );
}

/**
 * Redo/refresh icon
 * @param props - Icon properties
 */
export function IconRedo({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M463.5 224H472c13.3 0 24-10.7 24-24V72c0-9.7-5.8-18.5-14.8-22.2s-19.3-1.7-26.2 5.2L413.4 96.6c-87.6-86.5-228.7-86.2-315.8 1c-87.5 87.5-87.5 229.3 0 316.8s229.3 87.5 316.8 0c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0c-62.5 62.5-163.8 62.5-226.3 0s-62.5-163.8 0-226.3c62.2-62.2 162.7-62.5 225.3-1L327 183c-6.9 6.9-8.9 17.2-5.2 26.2s12.5 14.8 22.2 14.8H463.5z" />
    </Icon>
  );
}

/**
 * Zoom in icon
 * @param props - Icon properties
 */
export function IconZoomIn({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM184 296c0 13.3 10.7 24 24 24s24-10.7 24-24V232h64c13.3 0 24-10.7 24-24s-10.7-24-24-24H232V120c0-13.3-10.7-24-24-24s-24 10.7-24 24v64H120c-13.3 0-24 10.7-24 24s10.7 24 24 24h64v64z" />
    </Icon>
  );
}

/**
 * Zoom out icon
 * @param props - Icon properties
 */
export function IconZoomOut({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM120 184c-13.3 0-24 10.7-24 24s10.7 24 24 24H296c13.3 0 24-10.7 24-24s-10.7-24-24-24H120z" />
    </Icon>
  );
}

/**
 * Save icon
 * @param props - Icon properties
 */
/**
 * Globe / earth icon (globe-americas equivalent)
 * Used for "worlds only" entry type filter.
 * @param props - Icon properties
 */
export function IconGlobe({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M256 0a256 256 0 1 0 0 512A256 256 0 1 0 256 0zM179.2 100.7c-5.1 1.1-9.4 5.3-13.8 12.4c-3.6 5.8-7.7 14.2-10.5 20.2c-1.4 3-2.5 5.4-3.1 6.8c-1.7 3.5-3.7 6.1-9.7 6.7c-5.9 .6-10.3-2.3-15.4-6.6c-1.9-1.6-4.2-3.6-6.9-5.5c-3.6-2.5-7.7-3.9-10.5-4.5c35-52.4 91.8-88.5 157.5-95.6c-1.1 .5-2.2 1-3.3 1.6C248.3 44.8 222.8 51 203.6 65c-10.1 7.4-18.5 16.7-22.6 28.2c-.5 1.4-1 2.8-1.6 4.1c0 1.1 0 2.3-.2 3.4zm230 182.9c-1.2 2.4-3.6 4.8-8.9 7.3c-4.9 2.4-11.2 4.1-18.4 5.6c-14.5 3.1-33.1 4.8-52.7 6.5c-2.5 .2-5 .4-7.5 .7c-20.4 1.8-42 3.8-60.2 9.2c-12.2 3.7-23.6 9.1-31.5 17.8c-8 8.7-12 20-12 33.7v51.4c0 5.3-.4 10.3-2.4 14.5c-1.9 4-5.3 7.1-11.4 9.1c-34.4-12.8-63.5-36.3-83.5-66.4c5.4-5.4 13.4-10.1 23.6-14c12.3-4.7 27.2-8.2 42.8-11.5c2.6-.6 5.3-1.1 8-1.7c20.7-4.3 42.6-8.9 59.7-18.2c8.9-4.8 17-11.1 22.4-19.6c5.5-8.6 8-18.9 8-30.6c0-18.7-7.3-33.7-19-44.9c-11.5-11-26.2-17.5-39.5-22.5l-1.3-.5c-14.1-5.3-25.9-9.8-34.5-17.4c-3.8-3.4-6.3-6.8-7.9-10.5c-1.5-3.5-2.4-7.9-2.4-13.7c0-6.9 1.3-10.3 2.7-12.4c1.3-1.8 3.4-3.5 6.9-5c7.7-3.4 19.2-5 33-5h31.4c13.7 0 23.2-1.4 29.6-5.2c5.6-3.4 9.4-9.1 9.4-19.8c0-12.2-5.1-19.6-11.7-24.4c-7-5-16.5-7.6-24.5-7.6h-2.1c-9.7 0-14.1-6.3-17.4-11.5l-1.2-1.8c-3-4.6-6.4-9.6-11-13.5c-3.1-2.6-7-4.8-11.9-5.8c16.3-6.3 34-9.8 52.4-9.8c17.1 0 33.6 2.9 48.9 8.4c-.4 5.8-.1 12.4 2.4 18.7c3 7.5 9 13.2 17.6 16c7 2.2 12.7 5.4 16.7 8.4c1.6 1.2 2.8 2.3 3.7 3.1c-2.1 3.3-3.5 8-3.5 14.6c0 7.8 2.4 14.4 7.3 19.2c4.6 4.5 10.2 6.5 14.8 7.5c4.4 1 9.2 1.3 13.5 1.3h5.2c.7 0 1.5 0 2.2 0c.8 3.5 1.5 7 2.1 10.6c.3 1.6 .5 3.2 .7 4.9c-4 1.4-8.4 3.4-12.5 6.3c-6.3 4.4-12.1 11-14.4 20.1c-2.2 8.6-1.2 17.4 2.5 25.5zm46.4-73c-2.2-1.3-4.4-2.1-6.1-2.6c.5-3 .9-6 1.2-9c3.6 3.5 5.7 7.4 4.9 11.6z" />
    </Icon>
  );
}

export function IconSave({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 448 512" {...props}>
      <path d="M64 32C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V173.3c0-17-6.7-33.3-18.7-45.3L352 50.7C340 38.7 323.7 32 306.7 32H64zm0 96c0-17.7 14.3-32 32-32H288c17.7 0 32 14.3 32 32v64c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V128zM224 288a64 64 0 1 1 0 128 64 64 0 1 1 0-128z" />
    </Icon>
  );
}

/**
 * Download icon
 * @param props - Icon properties
 */
export function IconDownload({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 512 512" {...props}>
      <path d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32V274.7l-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7V32zM64 352c-35.3 0-64 28.7-64 64v32c0 35.3 28.7 64 64 64H448c35.3 0 64-28.7 64-64V416c0-35.3-28.7-64-64-64H346.5l-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352H64zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z" />
    </Icon>
  );
}

/**
 * Trash icon
 * @param props - Icon properties
 */
export function IconTrash({ size, className, ...props }: IconProps) {
  return (
    <Icon size={size} className={className} viewBox="0 0 448 512" {...props}>
      <path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z" />
    </Icon>
  );
}
