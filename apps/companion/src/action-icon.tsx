const paths = {
  edit: (
    <>
      <path d="m4 16 1-4L14 3l3 3-9 9-4 1Z" />
      <path d="m12 5 3 3" />
    </>
  ),
  upload: (
    <>
      <path d="M10 13V3m-4 4 4-4 4 4" />
      <path d="M4 12v5h12v-5" />
    </>
  ),
  delete: (
    <>
      <path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6" />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  check: <path d="m4 10 4 4 8-8" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  play: <path d="m6 3 11 7-11 7V3Z" />,
  pause: <path d="M7 4v12m6-12v12" />,
  stop: <path d="M5 5h10v10H5z" />,
};
export function ActionIcon({ kind }: { kind: keyof typeof paths }) {
  return (
    <svg
      className="action-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[kind]}
    </svg>
  );
}
