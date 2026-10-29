import Link from "next/link";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import { SupportContact } from "@/shared/ui/SupportContact";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>{ERROR_CATALOG.NOT_FOUND.message}</p>
      <p>
        <Link href="/">Go to the home page</Link>
      </p>
      <SupportContact />
    </main>
  );
}
