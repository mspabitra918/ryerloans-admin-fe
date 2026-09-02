import { redirect } from "next/navigation";

/** The portal has no public landing page; everything starts at the dashboard. */
export default function Home() {
  redirect("/dashboard");
}
