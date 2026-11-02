export default function Brand({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={`mc-brand ${className}`}>
      <img src="/brand/medcollab-mark.svg" alt="" width="30" height="33" />
      <span className="mc-brand-word">MedCollab{!compact && <small>医学数据资料库</small>}</span>
    </span>
  );
}
