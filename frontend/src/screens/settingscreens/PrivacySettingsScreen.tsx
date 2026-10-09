import SettingButtonDesc from "../../components/settings/SettingButtonDesc"
import { useAppSettingsStore } from "../../store/useAppSettingsStore"

const PrivacySettingsScreen = () => {
  const { blockUnknown, disableLinkPreviews, updateSetting } = useAppSettingsStore()

  return (
    <div className="flex flex-col gap-8 p-6 max-w-2xl mx-auto">
      <SettingButtonDesc
        title="Block Unknown Account Messages"
        description="To protect your account and improve device performance, WhatsApp will block messages from unknown accounts if they exceed a certain volume."
        isEnabled={blockUnknown}
        onToggle={() => updateSetting("blockUnknown", !blockUnknown)}
      />

      <SettingButtonDesc
        title="Disable Link Previews"
        description="To help protect your IP address from being inferred by third-party websites, previews for the links you share in chats will no longer be generated. Learn more"
        isEnabled={disableLinkPreviews}
        onToggle={() => updateSetting("disableLinkPreviews", !disableLinkPreviews)}
      />
    </div>
  )
}

export default PrivacySettingsScreen
