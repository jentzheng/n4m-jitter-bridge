import {
  createContext,
  useContext,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

type ConnectionState = {
  address: string;
  isWSconnected: boolean;
  isDCopened: boolean;
};

type ConnectionContextType = {
  dataChannelRef: RefObject<RTCDataChannel | null>;
  wsRef: RefObject<WebSocket | null>;
  connectionState: ConnectionState;
  setConnectionState: Dispatch<SetStateAction<ConnectionState>>;
};

export const ConnectionContext = createContext<ConnectionContextType>({
  dataChannelRef: { current: null },
  wsRef: { current: null },
  connectionState: {
    address: "",
    isWSconnected: false,
    isDCopened: false,
  },
  setConnectionState: () => {},
});

export function useConnection() {
  return useContext(ConnectionContext);
}
