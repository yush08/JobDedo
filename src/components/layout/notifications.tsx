"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { relativeTime } from "@/lib/utils/format";
import type { ApiResponse, AppNotification } from "@/types";

/**
 * Notification centre. Only ever shows notifications that actually exist in
 * the database — no synthetic activity is generated.
 */
export function Notifications() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/v1/notifications");
      if (!res.ok) throw new Error("Failed to load notifications");
      const json = (await res.json()) as ApiResponse<{
        items: AppNotification[];
        unread: number;
      }>;
      return json.ok ? json.data : { items: [], unread: 0 };
    },
    refetchInterval: 60_000,
  });

  const markRead = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/notifications", { method: "PATCH" });
      if (!res.ok) throw new Error("Failed to mark notifications read");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} />
        }
      >
        <span className="relative">
          <Bell className="size-4" aria-hidden />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          <Button
            variant="ghost"
            size="xs"
            disabled={unread === 0 || markRead.isPending}
            onClick={() => markRead.mutate()}
          >
            <CheckCheck className="size-3.5" aria-hidden />
            Mark all read
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No notifications yet. JobDedo only records real events (new strong
              matches, deadlines, verification changes, discovery failures).
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        item.read_at ? "bg-border" : "bg-primary"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.body}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground/80">
                        {relativeTime(item.created_at)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
