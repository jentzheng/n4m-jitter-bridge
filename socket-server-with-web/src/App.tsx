import { useState, useEffect, useCallback, useRef } from "react";
import { ConnectionContext } from "./utils/hooks";
import { NavLink, Outlet, useSearchParams } from "react-router";
import { io, type Socket } from "socket.io-client";

function App() {
  const [socket, setSocket] = useState<Socket>();
  const [pc, setPeerConnection] = useState<RTCPeerConnection>();
  const [dc, setDataChannel] = useState<RTCDataChannel>();
  const [remoteStream, setRemoteStream] = useState<MediaStream>();
  const remoteUserIdRef = useRef<string>(null);

  const [connectionState, setConnectionState] = useState({
    isSocketIOConnected: false,
    iceconnectionState: "unknown",
    connectionState: "unknown",
  });

  const [searchParams, setSearchParams] = useSearchParams();

  const [formState, setFormState] = useState({
    roomId: searchParams.get("roomId") || "MaxMSPJitter",
    jit_net_recv_port: searchParams.get("jit_net_recv_port") || "7575",
  });

  useEffect(() => {
    setSearchParams({
      roomId: formState.roomId,
      jit_net_recv_port: formState.jit_net_recv_port,
    });
  }, [formState, setSearchParams]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const connectSocketIO = useCallback((state: typeof formState) => {
    const socket = io({
      query: {
        roomId: state.roomId,
        name: "Chrome Browser",
        role: "guest",
        jitRecvPort: parseInt(state.jit_net_recv_port),
      },
    });

    setSocket(socket);
  }, []);

  const disconnectSocketIO = useCallback(() => {
    pc?.close();
    socket?.disconnect();
    setPeerConnection(undefined);
  }, [pc, socket]);

  const handleConnect = useCallback(() => {
    if (socket?.connected) {
      disconnectSocketIO();
    } else {
      connectSocketIO(formState);
    }
  }, [socket, disconnectSocketIO, connectSocketIO, formState]);

  useEffect(() => {
    connectSocketIO(formState);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const pc = new RTCPeerConnection();
    // pc.addTransceiver("video", { direction: "sendrecv" });
    setPeerConnection(pc);

    socket.on("connect", () => {
      setConnectionState((prev) => ({ ...prev, isSocketIOConnected: true }));
      socket.emit("join");
    });

    socket.on("disconnect", () => {
      setConnectionState((prev) => ({ ...prev, isSocketIOConnected: false }));
    });

    pc.onnegotiationneeded = async () => {
      // IT should tell node4m to resend offer
      if (remoteUserIdRef.current && pc.connectionState !== "new") {
        socket.emit("requestOffer", {
          to: remoteUserIdRef.current,
        });
      }
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate && remoteUserIdRef.current) {
        console.log("onicecandidate", event.type, remoteUserIdRef.current);
        socket.emit("signal", {
          to: remoteUserIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("pc.iceconnectionState:", pc.iceConnectionState);
      setConnectionState((prev) => ({
        ...prev,
        iceconnectionState: pc.iceConnectionState,
      }));
    };

    pc.onconnectionstatechange = () => {
      console.log("pc.connectionState:", pc.connectionState);
      setConnectionState((prev) => ({
        ...prev,
        connectionState: pc.connectionState,
      }));
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pc.ondatachannel = async (event) => {
      setDataChannel(event.channel);
    };

    socket.on(
      "signal",
      async ({
        from,
        description,
        candidate,
      }: {
        from: string;
        description: RTCSessionDescription;
        candidate: RTCIceCandidate;
      }) => {
        if (description) {
          // console.log(from, description.type);
          if (description.type === "offer") {
            remoteUserIdRef.current = from;

            await pc.setRemoteDescription(description);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("signal", {
              to: from,
              description: pc.localDescription,
            });
          }
        } else if (candidate) {
          await pc.addIceCandidate(candidate);
        }
      }
    );

    return () => {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.ondatachannel = null;
      pc.close();

      socket.off("connect");
      socket.off("disconnect");
      socket.close();
    };
  }, [socket]);

  return (
    <ConnectionContext.Provider value={{ remoteStream, pc, dc }}>
      <div className="drawer lg:drawer-open" data-theme="cupcake">
        {/* Sidebar Toggle Button */}
        <input id="sidebar-toggle" type="checkbox" className="drawer-toggle" />

        {/* Main Layout */}
        <div className="drawer-content flex flex-col max-h-screen">
          {/* Header: hamburger + nav links */}
          <header className="flex items-center gap-4 px-4 py-2  bg-base-100">
            <label
              htmlFor="sidebar-toggle"
              className="btn btn-square btn-ghost lg:hidden"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </label>

            <nav
              role="tablist"
              className="tabs tabs-bordered flex-grow overflow-x-auto"
            >
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
          </header>

          {/* Main Content */}
          <main className="bg-gray-600 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>

        {/* Sidebar */}
        <aside className="drawer-side">
          <label htmlFor="sidebar-toggle" className="drawer-overlay"></label>
          <div className="menu p-4 w-80 min-h-full bg-base-200 text-base-content">
            <form action={handleConnect}>
              <div className="grid gap-4">
                <label className="form-control w-full">
                  <div className="label">
                    <span className="label-text">Room ID</span>
                  </div>
                  <input
                    type="text"
                    name="roomId"
                    className="input input-bordered w-full"
                    disabled={socket?.connected}
                    value={formState.roomId}
                    onChange={handleChange}
                  />
                </label>

                <label className="form-control w-full">
                  <div className="label">
                    <span className="label-text">JitRecvPort</span>
                  </div>
                  <input
                    type="number"
                    name="jit_net_recv_port"
                    className="input input-bordered w-full"
                    disabled={socket?.connected}
                    value={formState.jit_net_recv_port}
                    onChange={handleChange}
                  />
                </label>

                <button type="submit" className="btn btn-primary">
                  {socket?.connected ? "Disconnect" : "Connect"}
                </button>
              </div>
            </form>

            <ul className="mt-1">
              <li>
                {connectionState.isSocketIOConnected
                  ? `Socket.IO: Connected ✅`
                  : "Socket.IO: Disconnected ❌"}
              </li>
              <li>ICEConnectionState: {connectionState.iceconnectionState}</li>
              <li>ConnectionState: {connectionState.connectionState}</li>
            </ul>
          </div>
        </aside>
      </div>
    </ConnectionContext.Provider>
  );
}

export default App;
