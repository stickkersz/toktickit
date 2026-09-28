import { Link } from "react-router-dom";
import { useAuth } from "../authContext.js";
import { landingPathFor } from "../roles.js";

// The forbidden state (ui-spec sections 7, 9 and 10): "you may not", visibly
// distinct from "it is not here" and from "something went wrong". It replaces the
// screen entirely, so nothing the screen would have shown or fetched is exposed.
export default function Forbidden({ message }: { message: string }) {
  const { user } = useAuth();
  return (
    <div className="container py-5" style={{ maxWidth: 560 }}>
      <div className="zg-alert-warning rounded p-4">
        <h1 className="h4 mb-2">Access denied</h1>
        <p className="mb-3">{message}</p>
        {user && (
          <Link to={landingPathFor(user.role)} className="btn zg-btn-primary zg-touch-target">
            Go to your home screen
          </Link>
        )}
      </div>
    </div>
  );
}
