import { createContext, useContext } from "react";

export const ConnectionContext = createContext<{
  remoteStream?: MediaStream;
  pc?: RTCPeerConnection;
  dc?: RTCDataChannel;
}>({});

export function useConnection() {
  const context = useContext(ConnectionContext);
  return context;
}
