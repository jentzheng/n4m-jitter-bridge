import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useSearchParams } from "react-router";
import { ConnectionContext } from "./hooks";

function App() {
  const [searchParams, setSearchParams] = useSearchParams({
    host: "localhost:8080",
    user: "pc1",
    token: "mysecret",
    jit_net_recv_port: "7575",
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const detectorWorkerRef = useRef<Worker | null>(null);

  const [connectionState, setConnectionState] = useState({
    address: `ws://${searchParams.get("host")}?user=${searchParams.get(
      "user"
    )}&token=${searchParams.get("token")}&jit_net_recv_port=${searchParams.get(
      "jit_net_recv_port"
    )}`,
    isWSconnected: false,
    isDCopened: false,
  });

  const initConnection = async (address: string) => {
    const ws = new WebSocket(address);
    wsRef.current = ws;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    ws.onopen = async () => {
      console.log("[WebSocket] connected");
      setConnectionState((val) => {
        return {
          ...val,
          isWSconnected: true,
        };
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify(offer));
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "answer": {
            await pc.setRemoteDescription(new RTCSessionDescription(msg));
            break;
          }

          case "candidate": {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            break;
          }

          default: {
            console.warn("Unknown message type:", msg.type);
            break;
          }
        }
      }
    };

    ws.onclose = () => {
      console.log("[WebSocket] closed");
      setConnectionState((val) => {
        return {
          ...val,
          isWSconnected: false,
        };
      });
    };

    ws.onerror = (e) => {
      console.error("[WebSocket] error", e);
    };

    // send candidate to remote
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log("CLIENT: Sending ICE candidate to server");
        ws.send(JSON.stringify({ type: "candidate", candidate }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log("PC state:", pc.connectionState);
    };

    const dataChannel = pc.createDataChannel("frames", {});
    dataChannel.binaryType = "arraybuffer";
    dataChannelRef.current = dataChannel;

    dataChannel.onopen = () => {
      setConnectionState((val) => {
        return {
          ...val,
          isDCopened: true,
        };
      });

      console.log("[WebRTC] DataChannel is open");
    };

    dataChannel.onclose = () => {
      console.log("[WebRTC] DataChannel closed");

      setConnectionState((val) => {
        return {
          ...val,
          isDCopened: false,
        };
      });
    };
  };

  const disconnect = () => {
    if (detectorWorkerRef.current) {
      detectorWorkerRef.current.terminate();
      detectorWorkerRef.current = null;
    }

    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // init connection
  useEffect(() => {
    initConnection(connectionState.address);
    return () => {
      disconnect();
    };
  }, [connectionState.address]);

  return (
    <ConnectionContext.Provider
      value={{
        dataChannelRef,
        wsRef,
        connectionState,
        setConnectionState,
      }}
    >
      <div
        className="grid grid-rows-[auto_1fr_auto] min-h-screen"
        data-theme="cupcake"
      >
        <form
          action={(formdata) => {
            const host = formdata.get("host");
            const user = formdata.get("user");
            const token = formdata.get("token");
            const jitNetRecvPort = formdata.get("jit_net_recv_port");

            console.log(jitNetRecvPort);

            if (connectionState.isWSconnected) {
              disconnect();
            } else if (host && user && token && jitNetRecvPort) {
              setConnectionState((val) => {
                return {
                  ...val,
                  address: `ws://${host}?user=${user}&token=${token}&jit_net_recv_port=${jitNetRecvPort}`,
                };
              });

              initConnection(connectionState.address as string);
            }
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 w-full items-end ">
            <label className="input w-full" htmlFor="host">
              Host:
              <input
                type="text"
                id="host"
                name="host"
                className="grow"
                placeholder="localhost:8080"
                value={searchParams.get("host") || ""}
                onChange={(e) => {
                  setSearchParams({
                    ...Object.fromEntries(searchParams),
                    host: e.target.value,
                  });
                }}
              />
            </label>

            <label className="input w-full" htmlFor="username">
              User:
              <input
                type="text"
                name="user"
                className="grow"
                value={searchParams.get("user") || ""}
                onChange={(e) => {
                  setSearchParams({
                    ...Object.fromEntries(searchParams),
                    user: e.target.value,
                  });
                }}
              />
            </label>

            <label className="input w-full" htmlFor="token">
              Password:
              <input
                type="text"
                name="token"
                className="grow"
                value={searchParams.get("token") || ""}
                onChange={(e) => {
                  setSearchParams({
                    ...Object.fromEntries(searchParams),
                    token: e.target.value,
                  });
                }}
              />
            </label>

            <label className="input w-full" htmlFor="token">
              JitRecvPort:
              <input
                type="number"
                name="jit_net_recv_port"
                className="grow"
                value={searchParams.get("jit_net_recv_port") || ""}
                onChange={(e) => {
                  setSearchParams({
                    ...Object.fromEntries(searchParams),
                    jit_net_recv_port: e.target.value,
                  });
                }}
              />
            </label>

            <button type="submit" className="btn btn-primary">
              {connectionState.isWSconnected ? "Disconnect" : "Connect"}
            </button>
          </div>
        </form>

        <main className=" bg-gray-600 max-h-full">
          <nav role="tablist" className="tabs tabs-border">
            <NavLink
              role="tab"
              className={({ isActive }) =>
                isActive ? "tab tab-active" : "tab"
              }
              to="/"
            >
              Detection
            </NavLink>
            <NavLink
              role="tab"
              className={({ isActive }) =>
                isActive ? "tab tab-active" : "tab"
              }
              to="/camera"
            >
              Camera
            </NavLink>
          </nav>

          <Outlet />
        </main>

        <footer className="text-xs py-2 px-4">
          <ul>
            <li>
              {connectionState.isWSconnected
                ? `${connectionState.address} Connected`
                : "Websocket Disconnected"}
            </li>
            <li>
              DataChannel: {connectionState.isDCopened ? "Opened" : "Closed"}
            </li>
            {/* <li>Video Device ID: {selectedDeviceId}</li> */}
          </ul>
        </footer>
      </div>
    </ConnectionContext.Provider>
  );
}

export default App;
