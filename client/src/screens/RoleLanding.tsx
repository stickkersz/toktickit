import { Link, useParams } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { RoleBadge } from "../Badge.js";

// Placeholder for the staff and administrator landing routes, which the later
// Issues fill in (Ticket Queue, User Management). It exists so signing in as either
// role lands somewhere honest. Logout and navigation come from the shell around it.
export default function RoleLanding({ destination }: { destination: string }) {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="h4">Signed in as {user.name}</h1>
      <p>
        <RoleBadge role={user.role} />
      </p>
      <p className="text-muted">The {destination} screen arrives in a later Lab 3 Issue.</p>
    </div>
  );
}

// Stands in for the IT Staff Ticket Detail until it arrives in a later Issue, so a row in the
// queue opens somewhere honest instead of falling through to an unknown-URL redirect.
export function StaffTicketDetailPlaceholder() {
  const { id } = useParams();
  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="h4">Ticket Detail</h1>
      <p className="text-muted">The IT Staff Ticket Detail screen for ticket {id} arrives in a later Lab 3 Issue.</p>
      <Link to="/staff/tickets" className="btn btn-outline-secondary zg-touch-target">
        Back to Queue
      </Link>
    </div>
  );
}
