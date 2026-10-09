import { useState, useRef, useEffect } from "react"
import clsx from "clsx"

interface DropDownProps {
  title: string
  elements: string[]
  icon?: React.ReactNode
  onToggle: (element: string) => void
  placeholder?: string
}

const DropDown = ({
  title,
  elements,
  icon,
  onToggle,
  placeholder = "Select an option",
}: DropDownProps) => {
  const [onOpen, setOnOpen] = useState(false)
  const [selectedElement, setSelectedElement] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleSelect = (element: string) => {
    setSelectedElement(element)
    onToggle(element)
    setOnOpen(false)
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOnOpen(false)
      }
    }

    if (onOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onOpen])

  return (
    <div ref={containerRef} className="flex flex-col relative">
      <div className="font-semibold mb-2">{title}</div>
      <div
        className="bg-dropdown-bg dark:bg-dropdown-dark-bg cursor-pointer flex items-center justify-between p-2 hover:bg-dropdown-hover-bg dark:hover:bg-dropdown-dark-hover-bg rounded-md transition-colors border border-dropdown-border dark:border-dropdown-dark-border text-dropdown-text dark:text-dropdown-dark-text"
        onClick={() => setOnOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span>{selectedElement || placeholder}</span>
        </div>
        <span
          className={clsx(
            "inline-block transition-transform duration-200 text-xs",
            onOpen ? "rotate-180" : "rotate-0",
          )}
        >
          ▼
        </span>
      </div>
      {onOpen && (
        <div className="mt-2 bg-dropdown-element-bg dark:bg-dropdown-element-dark-bg rounded-md shadow-lg border border-dropdown-border dark:border-dropdown-border overflow-hidden">
          {elements.map((element, index) => (
            <div
              key={index}
              className={clsx(
                "p-2 hover:bg-dropdown-element-hover-bg dark:hover:bg-dropdown-element-dark-hover-bg cursor-pointer transition-colors text-dropdown-element-text dark:text-dropdown-element-dark-text",
                selectedElement === element
                  ? "bg-dropdown-element-hover-bg dark:bg-dropdown-element-dark-hover-bg"
                  : "",
              )}
              onClick={() => handleSelect(element)}
            >
              {element}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default DropDown
