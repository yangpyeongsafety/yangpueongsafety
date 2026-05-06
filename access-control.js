(function attachAccessControl(global) {
  const APPROVER_LOGIN_IDS = ["fulmin2025", "envu86"];

  function normalizeLoginId(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizeRole(value) {
    return value === "admin" ? "admin" : "worker";
  }

  function isWorkerRole(role) {
    return normalizeRole(role) === "worker";
  }

  function isAdminRole(role) {
    return normalizeRole(role) === "admin";
  }

  function toAuthEmail(loginId) {
    const safeId = normalizeLoginId(loginId).replace(/[^a-z0-9._-]/g, "_");
    return `${safeId}@yangpyeongsafety.app`;
  }

  function isApproverLoginId(loginId) {
    return APPROVER_LOGIN_IDS.includes(normalizeLoginId(loginId));
  }

  function isAdminApprover(profile) {
    if (!isAdminRole(profile?.role) || !isApproverLoginId(profile?.login_id)) {
      return false;
    }
    return profile?.can_manage_admin_approvals !== false;
  }

  function isApprovedAdmin(profile) {
    if (!isAdminRole(profile?.role)) {
      return false;
    }
    if (isAdminApprover(profile)) {
      return true;
    }
    return profile?.admin_approved !== false;
  }

  function isPendingAdmin(profile) {
    return isAdminRole(profile?.role) && !isApprovedAdmin(profile);
  }

  function canUseAdminService(profile) {
    return isApprovedAdmin(profile);
  }

  function canApproveAdminSignups(profile) {
    return isAdminApprover(profile) && isApprovedAdmin(profile);
  }

  function getAdminApprovalMessage() {
    return "관리자 계정은 승인 후 이용할 수 있습니다. fulmin2025 또는 envu86 계정에서 승인해 주세요.";
  }

  function getAdminAccessDeniedMessage(profile) {
    if (!profile || !isAdminRole(profile.role)) {
      return "관리자 계정으로 로그인해 주세요.";
    }
    if (!canUseAdminService(profile)) {
      return getAdminApprovalMessage();
    }
    return "관리자 권한이 필요합니다.";
  }

  function getDefaultPageForProfile(profile) {
    if (!profile) {
      return "index.html";
    }
    if (canApproveAdminSignups(profile)) {
      return "admin-approvals.html";
    }
    if (canUseAdminService(profile)) {
      return "main.html";
    }
    if (isWorkerRole(profile.role)) {
      return "worker-entry.html";
    }
    return "index.html";
  }

  function updateStoredSessionProfile(profile) {
    try {
      const raw = localStorage.getItem("workforce.session");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed) {
        return;
      }
      localStorage.setItem("workforce.session", JSON.stringify({ ...parsed, profile }));
    } catch (error) {
      console.error(error);
    }
  }

  global.accessControl = {
    approverLoginIds: [...APPROVER_LOGIN_IDS],
    normalizeLoginId,
    normalizePhone,
    normalizeRole,
    isWorkerRole,
    isAdminRole,
    toAuthEmail,
    isApproverLoginId,
    isAdminApprover,
    isApprovedAdmin,
    isPendingAdmin,
    canUseAdminService,
    canApproveAdminSignups,
    getAdminApprovalMessage,
    getAdminAccessDeniedMessage,
    getDefaultPageForProfile,
    updateStoredSessionProfile
  };
})(window);
