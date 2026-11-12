"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./button";
import { PendingLabel } from "./pending-label";

export function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-busy={pending}><PendingLabel pending={pending}>{children}</PendingLabel></Button>;
}
