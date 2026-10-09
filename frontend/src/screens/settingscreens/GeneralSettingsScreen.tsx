import { useEffect, useState } from "react"
import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import DropDown from "../../components/settings/DropDown"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"
import { SelectDownloadDirectory, GetDownloadDirectory } from "../../../wailsjs/go/api/Api"

const GeneralSettingsScreen = () => {
  const { startAtLogin, minimizeToTray, language, fontSize, downloadDir, updateSetting } =
    useAppSettingsStore()
  const [resolvedDir, setResolvedDir] = useState<string>("")

  useEffect(() => {
    GetDownloadDirectory()
      .then(d => setResolvedDir(d || ""))
      .catch(() => {})
  }, [downloadDir])

  const handleChangeDownloadDir = async () => {
    try {
      const dir = await SelectDownloadDirectory()
      if (dir) {
        await updateSetting("downloadDir", dir)
        setResolvedDir(dir)
      }
    } catch (err) {
      console.error("Failed to select download directory:", err)
    }
  }

  const handleResetDownloadDir = async () => {
    await updateSetting("downloadDir", "")
    const def = await GetDownloadDirectory()
    setResolvedDir(def || "")
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingButtonDesc
        title="Start Whatsapp at login"
        description=""
        onToggle={() => updateSetting("startAtLogin", !startAtLogin)}
        isEnabled={startAtLogin}
      />
      <SettingButtonDesc
        title="Minimize to system tray"
        description="Keep Whatsapp running after closing the application window"
        onToggle={() => updateSetting("minimizeToTray", !minimizeToTray)}
        isEnabled={minimizeToTray}
      />
      <div className="flex flex-row justify-between items-start py-4 border-t border-b border-gray-200 dark:border-white/10">
        <div className="flex flex-col flex-1 pr-6 min-w-0">
          <h3 className="text-lg font-medium text-black dark:text-white">Download location</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-all font-mono">
            {resolvedDir || downloadDir || "~/Downloads/Whats4L"}
          </p>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Media, documents, and downloaded files are saved here
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 shrink-0">
          <button
            onClick={handleChangeDownloadDir}
            className="px-3.5 py-1.5 rounded-lg bg-gray-200 dark:bg-[#202c33] hover:bg-gray-300 dark:hover:bg-[#2a3942] text-sm font-medium text-black dark:text-white transition-colors cursor-pointer"
          >
            Change
          </button>
          {downloadDir && (
            <button
              onClick={handleResetDownloadDir}
              className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-white/5 text-sm text-gray-600 dark:text-gray-300 transition-colors cursor-pointer"
              title="Reset to default (~/Downloads/Whats4L)"
            >
              Reset
            </button>
          )}
        </div>
      </div>
      <DropDown
        title="Language"
        elements={["English", "Spanish", "French"]}
        onToggle={(value: string) => updateSetting("language", value)}
        // selectedValue={language}
      />
      <DropDown
        title="Font Size"
        elements={["80%", "90%", "100% (Default)", "110%", "120%", "130%"]}
        onToggle={(value: string) => updateSetting("fontSize", value)}
        // selectedValue={fontSize}
      />
      <div>Use Ctrl + / - to increase or decrease font size</div>
    </div>
  )
}

export default GeneralSettingsScreen
