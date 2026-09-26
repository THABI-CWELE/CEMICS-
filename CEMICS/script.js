/* =========================================================
   CEMICS — shared front-end logic for login.html and register.html
   Update LOGIN_ENDPOINT / REGISTER_ENDPOINT once the backend
   (Node/Express/MongoDB) routes exist.
========================================================= */

const LOGIN_ENDPOINT = "/api/auth/login";
const REGISTER_ENDPOINT = "/api/auth/register";

function dashboardUrlForRole(role) {
  if (role === "seeker") return "dashboard-seeker.html";
  if (role === "employer" || role === "councillor") return "dashboard-poster.html";
  if (role === "admin") return "dashboard-admin.html";
  if (role === "actor") return "dashboard-actor.html";
  return "index.html";
}

function saveSession(token, user) {
  localStorage.setItem("cemics_token", token);
  localStorage.setItem("cemics_user", JSON.stringify(user));
}

/* ---------------- shared validation helpers ---------------- */

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidSAPhone(value) {
  const digits = value.replace(/\D/g, "");
  return /^0\d{9}$/.test(digits) || /^27\d{9}$/.test(digits);
}

function isValidSAID(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = parseInt(digits[i], 10);
    if (i % 2 !== 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[12], 10);
}

function showFieldError(form, fieldName, message) {
  const input = form.elements[fieldName];
  const errorEl = form.querySelector(`.field-error-msg[data-for="${fieldName}"]`);
  if (input) {
    const wrapper = input.closest(".field");
    if (wrapper) wrapper.classList.add("field-error");
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add("is-visible");
  }
}

function clearFieldError(form, fieldName) {
  const input = form.elements[fieldName];
  const errorEl = form.querySelector(`.field-error-msg[data-for="${fieldName}"]`);
  if (input) {
    const wrapper = input.closest(".field");
    if (wrapper) wrapper.classList.remove("field-error");
  }
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.remove("is-visible");
  }
}

function clearAllFieldErrors(form) {
  form.querySelectorAll(".field-error-msg").forEach((el) => {
    el.textContent = "";
    el.classList.remove("is-visible");
  });
  form.querySelectorAll(".field-error").forEach((el) => el.classList.remove("field-error"));
}

/* ============================================================
   LOGIN PAGE
============================================================ */

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  const formAlert = document.getElementById("formAlert");

  loginForm.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && field.classList.contains("field-error")) {
      clearFieldError(loginForm, e.target.name);
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllFieldErrors(loginForm);
    formAlert.classList.remove("is-visible");

    const data = new FormData(loginForm);
    const email = (data.get("email") || "").toString();
    const password = (data.get("password") || "").toString();

    let valid = true;
    if (!isValidEmail(email)) {
      showFieldError(loginForm, "email", "Enter a valid email address.");
      valid = false;
    }
    if (password.length < 8) {
      showFieldError(loginForm, "password", "Password must be at least 8 characters.");
      valid = false;
    }
    if (!valid) return;

    const submitBtn = loginForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in\u2026";

    try {
      const res = await fetch(LOGIN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Invalid credentials.");

      saveSession(result.token, result.user);
      window.location.href = dashboardUrlForRole(result.user.role);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
      formAlert.textContent = err.message || "We couldn't log you in. Check your details and try again.";
      formAlert.classList.add("is-visible");
    }
  });
}

/* ============================================================
   REGISTER PAGE
============================================================ */

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  const successState = document.getElementById("successState");
  const successMessage = document.getElementById("successMessage");
  const roleHeading = document.getElementById("roleHeading");
  const roleBadges = document.querySelectorAll(".role-badge");

  const roleFieldGroups = {
    seeker: document.getElementById("fields-seeker"),
    employer: document.getElementById("fields-employer"),
    councillor: document.getElementById("fields-councillor"),
  };

  const roleHeadings = {
    seeker: "Community member profile",
    employer: "Company profile",
    councillor: "Municipal profile",
  };

  const roleRequiredFields = {
    seeker: ["qualification"],
    employer: ["companyName", "companyReg", "industry", "jobTitle"],
    councillor: ["municipality", "municipalOffice", "wardNumber", "position"],
  };

  let currentRole = "seeker";

  function setRole(role) {
    if (!roleFieldGroups[role]) return;
    currentRole = role;

    roleBadges.forEach((badge) => {
      const isActive = badge.dataset.role === role;
      badge.classList.toggle("is-active", isActive);
      badge.setAttribute("aria-selected", String(isActive));
    });

    Object.entries(roleFieldGroups).forEach(([key, el]) => {
      el.hidden = key !== role;
    });

    roleHeading.textContent = roleHeadings[role];
    clearAllFieldErrors(registerForm);
  }

  roleBadges.forEach((badge) => {
    badge.addEventListener("click", () => setRole(badge.dataset.role));
  });

  // Pre-select role from a homepage link like register.html?role=employer
  const params = new URLSearchParams(window.location.search);
  const requestedRole = params.get("role");
  setRole(requestedRole && roleFieldGroups[requestedRole] ? requestedRole : "seeker");

  const sameAddress = document.getElementById("sameAddress");
  const companyAddressField = document.getElementById("companyAddressField");
  const companyAddressInput = document.getElementById("companyAddress");

  sameAddress.addEventListener("change", () => {
    companyAddressField.hidden = sameAddress.checked;
    if (sameAddress.checked) {
      companyAddressInput.value = document.getElementById("address").value;
    }
  });

  function validateField(name, value, required, validator, message) {
    if (required && !value.trim()) {
      showFieldError(registerForm, name, "This field is required.");
      return false;
    }
    if (value.trim() && validator && !validator(value)) {
      showFieldError(registerForm, name, message);
      return false;
    }
    clearFieldError(registerForm, name);
    return true;
  }

  function validateRegisterForm() {
    clearAllFieldErrors(registerForm);
    let valid = true;
    const check = (ok) => { if (!ok) valid = false; };

    const data = new FormData(registerForm);
    const get = (name) => (data.get(name) || "").toString();

    check(validateField("firstName", get("firstName"), true));
    check(validateField("lastName", get("lastName"), true));
    check(validateField("idNumber", get("idNumber"), true, isValidSAID, "Enter a valid 13-digit South African ID number."));
    check(validateField("phone", get("phone"), true, isValidSAPhone, "Enter a valid South African phone number."));
    check(validateField("email", get("email"), true, isValidEmail, "Enter a valid email address."));
    check(validateField("address", get("address"), true));

    const password = get("password");
    const confirmPassword = get("confirmPassword");
    check(validateField("password", password, true, (v) => v.length >= 8 && /\d/.test(v),
      "Password must be at least 8 characters and include a number."));
    check(validateField("confirmPassword", confirmPassword, true, () => confirmPassword === password,
      "Passwords do not match."));

    (roleRequiredFields[currentRole] || []).forEach((fieldName) => {
      check(validateField(fieldName, get(fieldName), true));
    });

    if (currentRole === "employer" && !sameAddress.checked) {
      check(validateField("companyAddress", get("companyAddress"), true));
    }

    if (!registerForm.elements["terms"].checked) {
      showFieldError(registerForm, "terms", "You must accept the terms to continue.");
      valid = false;
    } else {
      clearFieldError(registerForm, "terms");
    }

    return valid;
  }

  registerForm.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field && field.classList.contains("field-error")) {
      clearFieldError(registerForm, e.target.name);
    }
  });

  function buildPayload() {
    const data = new FormData(registerForm);
    const get = (name) => (data.get(name) || "").toString().trim();

    const base = {
      role: currentRole,
      firstName: get("firstName"),
      lastName: get("lastName"),
      idNumber: get("idNumber"),
      phone: get("phone"),
      email: get("email"),
      address: get("address"),
      password: get("password"),
    };

    if (currentRole === "seeker") {
      return {
        ...base,
        profile: {
          dateOfBirth: get("dob"),
          gender: get("gender"),
          qualification: get("qualification"),
          fieldOfInterest: get("field"),
          skills: get("skills"),
        },
      };
    }

    if (currentRole === "employer") {
      return {
        ...base,
        profile: {
          companyName: get("companyName"),
          companyRegistrationNumber: get("companyReg"),
          industry: get("industry"),
          jobTitle: get("jobTitle"),
          companySize: get("companySize"),
          companyAddress: sameAddress.checked ? get("address") : get("companyAddress"),
        },
      };
    }

    return {
      ...base,
      profile: {
        municipality: get("municipality"),
        municipalOffice: get("municipalOffice"),
        wardNumber: get("wardNumber"),
        position: get("position"),
        staffId: get("staffId"),
      },
    };
  }

  async function submitRegistration(payload) {
    const res = await fetch(REGISTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || "Registration failed.");
    saveSession(result.token, result.user);
    return result;
  }

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateRegisterForm()) {
      const firstError = registerForm.querySelector(".field-error input, .field-error select, .field-error textarea");
      if (firstError) firstError.focus();
      return;
    }

    const submitBtn = registerForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account\u2026";

    try {
      const payload = buildPayload();
      const result = await submitRegistration(payload);

      const roleLabel = { seeker: "community member", employer: "employer", councillor: "councillor" }[currentRole];
      successMessage.textContent = `Your CEMICS ${roleLabel} account is ready. Taking you to your dashboard...`;

      registerForm.hidden = true;
      document.querySelector(".role-select").hidden = true;
      document.querySelector(".form-footnote").hidden = true;
      successState.hidden = false;

      setTimeout(() => {
        window.location.href = dashboardUrlForRole(result.user.role);
      }, 1400);
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create account";
      alert(err.message || "Something went wrong while creating your account. Please try again.");
    }
  });
}
