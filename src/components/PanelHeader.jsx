export default function PanelHeader({ icon: Icon, title, color = 'text-[#00FF9D]', right }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
      <h2 className={`text-[10px] font-bold tracking-wider ${color}`}>{title}</h2>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
