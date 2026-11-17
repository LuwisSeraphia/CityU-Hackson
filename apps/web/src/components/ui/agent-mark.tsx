export function AgentMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`agent-mark ${small ? "agent-mark-small" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}
