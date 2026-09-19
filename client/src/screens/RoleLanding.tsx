import { useNavigate } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { ROLE_LABEL } from "../roles.js";

// Placeholder for the staff and administrator landing routes, which the later
// Issues fill in (Ticket Queue, User Management). It exists so signing in as
// either role lands somewhere honest instead of bouncing into the Lab 2 flow,
// and it offers Logout until the role-aware shell arrives.
export default function RoleLanding({ destination }: { destination: string }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="container py-5" style={{ maxWidth: 560 }}>
      <h1 className="h4">Signed in as {user.name}</h1>
      <p>
        <span className="zg-badge zg-badge-role">{ROLE_LABEL[user.role]}</span>
      </p>
      <p className="text-muted">The {destination} screen arrives in a later Lab 3 Issue.</p>
      <button
        type="button"
        className="btn btn-outline-secondary zg-touch-target"
        onClick={async () => {
          await signOut();
          navigate("/login", { replace: true });
        }}
      >
        Logout
      </button>
    </div>
  );
}
