"""Models package — import all for Alembic autogenerate discovery."""
from app.models.audit_log import AuditLog
from app.models.exam import Exam
from app.models.exercise import Exercise
from app.models.invite import InviteToken
from app.models.refresh_token import RefreshToken
from app.models.scan_submission import ScanSubmission
from app.models.student_identity import StudentIdentity
from app.models.teacher import Teacher

__all__ = [
    "Teacher",
    "InviteToken",
    "RefreshToken",
    "Exam",
    "Exercise",
    "StudentIdentity",
    "ScanSubmission",
    "AuditLog",
]
