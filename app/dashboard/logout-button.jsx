"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError("");

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`Logout failed with ${response.status}`);
      router.replace("/login");
    } catch (error) {
      console.error("Could not log out", error);
      setLogoutError("Could not log out. Please try again.");
      setIsLoggingOut(false);
    }
  }

  return (
    <>
      {logoutError ? (
        <p role="alert" className="px-3 py-2 text-sm text-red-600">
          {logoutError}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="mt-auto rounded-md px-3 py-2 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
      >
        {isLoggingOut ? "Logging out..." : "Log out"}
      </button>
    </>
  );
}
