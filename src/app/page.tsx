import { redirect } from "next/navigation";

/**
 * JobDedo opens directly on the Overview dashboard.
 * There is no authentication screen: this is a single-user application.
 */
export default function Home() {
  redirect("/overview");
}
