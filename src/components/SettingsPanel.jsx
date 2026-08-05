import { Settings, Cpu, Bell, Shield } from 'lucide-react';

export default function SettingsPanel() {
  return (
    <div className="glass p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-4 h-4 text-[#00FF9D]" />
        <h2 className="text-sm font-bold text-[#00FF9D]">SYSTEM CONFIG</h2>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-[#00ff9d11]">
          <div className="flex items-center gap-2"><Cpu className="w-4 h-4 text-gray-400" /><span className="text-xs">Performance Mode</span></div>
          <span className="text-xs text-[#00FF9D]">Ultra</span>
        </div>
        <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-[#00ff9d11]">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4 text-gray-400" /><span className="text-xs">Notifications</span></div>
          <span className="text-xs text-[#00FF9D]">On</span>
        </div>
        <div className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-[#00ff9d11]">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4 text-gray-400" /><span className="text-xs">Stealth Mode</span></div>
          <span className="text-xs text-gray-500">Off</span>
        </div>
      </div>
    </div>
  );
}
