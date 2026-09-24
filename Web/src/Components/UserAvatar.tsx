import { Avatar } from "@heroui/react";

export function UserAvatar({ username }: { username: string }) {
  return (
    <Avatar size="sm" color="accent" variant="soft" className="shrink-0">
      <Avatar.Fallback>{username.slice(0, 1).toUpperCase()}</Avatar.Fallback>
    </Avatar>
  );
}
