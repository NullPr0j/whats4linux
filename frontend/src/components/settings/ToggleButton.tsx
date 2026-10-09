import clsx from "clsx"

interface ToggleButtonProps {
  isEnabled: boolean
  onToggle: () => void
}

const ToggleButton = ({ isEnabled, onToggle }: ToggleButtonProps) => {
  return (
    <div
      onClick={onToggle}
      className={clsx(
        "h-7 w-12 rounded-full flex items-center px-1 cursor-pointer shrink-0 transition-colors duration-200",
        isEnabled
          ? "bg-toggle-bg dark:bg-toggle-dark-bg"
          : "bg-toggle-closed dark:bg-toggle-dark-closed",
      )}
    >
      <div
        className={clsx(
          "size-5 rounded-full bg-toggle-circle dark:bg-toggle-dark-circle border border-black/10 dark:border-transparent shadow-md transition-transform duration-200",
          isEnabled ? "translate-x-5" : "translate-x-0",
        )}
      />
    </div>
  )
}

export default ToggleButton
