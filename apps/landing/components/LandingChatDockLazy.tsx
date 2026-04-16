"use client";

import dynamic from "next/dynamic";

const ChatDock = dynamic(
  () =>
    import("@/components/ChatDock").then((mod) => ({ default: mod.ChatDock })),
  { ssr: false },
);

export function LandingChatDockLazy() {
  return <ChatDock />;
}
