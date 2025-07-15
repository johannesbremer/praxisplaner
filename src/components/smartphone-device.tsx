import type { ReactNode } from "react";

interface SmartphoneDeviceProps {
  children: ReactNode;
  className?: string;
}

export function SmartphoneDevice({
  children,
  className = "",
}: SmartphoneDeviceProps) {
  return (
    <div className={`device-iphone-14-pro ${className}`}>
      <div className="device-frame device-stripe device-home">
        <div className="device-header"></div>
        <div className="device-sensors"></div>
        <div className="device-btns"></div>
        <div className="device-power"></div>
        <div className="device-screen">{children}</div>
      </div>
    </div>
  );
}
