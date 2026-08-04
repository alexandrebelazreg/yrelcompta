export function FormMessage({ message, kind = "error" }: { message?: string; kind?: "error" | "success" }) {
  if (!message) return null;
  return <p role={kind === "error" ? "alert" : "status"} className={`form-message ${kind}`}>{message}</p>;
}
