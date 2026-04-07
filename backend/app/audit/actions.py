"""Stable audit action names — extend as you add features."""

from __future__ import annotations


class AuditAction:
    """String constants for `audit_logs.action`. Add new actions here over time."""

    LOGIN = "login"
    LOGOUT = "logout"
    CONSENT_ACCEPTED = "consent_accepted"
    QUIZ_ATTEMPT_STARTED = "quiz_attempt_started"
    # All questions answered correctly (attempt succeeded).
    QUIZ_ATTEMPT_FINISHED = "quiz_attempt_finished"
    # Wrong answer ended the attempt (score reflects prior correct only).
    QUIZ_ATTEMPT_WRONG_EXIT = "quiz_attempt_wrong_exit"
    QUIZ_TIMEOUT = "quiz_timeout"
    # Future examples:
    # SUBMISSION_CREATED = "submission_created"
    # FILE_UPLOADED = "file_uploaded"
