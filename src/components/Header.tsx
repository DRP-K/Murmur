interface HeaderProps {
  title: string;
  onBack?: () => void;
  action?: React.ReactNode;
}

export default function Header({ title, onBack, action }: HeaderProps) {
  return (
    <header className="flex items-center h-14 px-4 bg-white border-b border-gray-200 gap-3 shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="text-indigo-600 text-lg w-8 flex items-center"
        >
          ‹
        </button>
      )}
      <h1 className="flex-1 font-semibold text-gray-900 truncate">{title}</h1>
      {action && <div>{action}</div>}
    </header>
  );
}
