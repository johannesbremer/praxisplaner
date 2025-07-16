import type { ReactNode } from "react";

interface ProDisplayXDRDeviceProps {
  children: ReactNode;
  className?: string;
}

export function ProDisplayXDRDevice({
  children,
  className = "",
}: ProDisplayXDRDeviceProps) {
  return (
    <div className={`device-pro-display-xdr ${className}`}>
      <div className="device-frame">
        <div className="device-screen">{children}</div>
      </div>
      <div className="device-power"></div>
      <div className="device-home"></div>
    </div>
  );
}

// Legacy export for backward compatibility
export const XDRDevice = ProDisplayXDRDevice;
