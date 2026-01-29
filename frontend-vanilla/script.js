// ===== 1. State & Config =====

// Application state
const state = {
  emails: [],
  selectedEmail: null,
  settings: {
    model: "deepseek-coder:instruct",
    theme: "light",
    viewMode: "list", // list or card
  },
  isLoading: false,
  isSummarizing: false,
  isBulkSummarizing: false,
  isGeneratingReply: false,
  searchQuery: "",
  filterType: "all",
  activeCategory: "all",
  bulkProgress: {
    current: 0,
    total: 0,
  },
}

// API Configuration - Update this to match your server
const API_BASE_URL = "http://localhost:3001"

// ===== 2. Utilities =====

function formatDate(dateString) {
  const date = new Date(dateString)
  const now = new Date()

  // Check if it's today
  if (date.toDateString() === now.toDateString()) {
    return `Today at ${date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    })}`
  }

  // Check if it's yesterday
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    })}`
  }

  // Otherwise show full date
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function showToast(title, description, type = "success") {
  const toastContainer = document.getElementById("toast-container")
  const toast = document.createElement("div")
  toast.className = `toast ${type} fade-in`

  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-title">${title}</div>
      <button class="toast-close">&times;</button>
    </div>
    <div class="toast-description">${description}</div>
  `

  toastContainer.appendChild(toast)

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast)
    }
  }, 5000)

  // Manual close
  toast.querySelector(".toast-close").addEventListener("click", () => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast)
    }
  })
}

function showLoading(show = true) {
  const overlay = document.getElementById("loading-overlay")
  if (show) {
    overlay.classList.remove("hidden")
  } else {
    overlay.classList.add("hidden")
  }
}

function copyToClipboard(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast("Copied", "Text copied to clipboard")
    })
    .catch(() => {
      showToast("Error", "Failed to copy to clipboard", "error")
    })
}

function saveEmailsToLocal() {
  try {
    localStorage.setItem("emails", JSON.stringify(state.emails))
  } catch (error) {
    console.error("Failed to save emails to localStorage", error)
  }
}

function loadEmailsFromLocal() {
  try {
    const saved = localStorage.getItem("emails")
    if (saved) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        state.emails = parsed
      }
    }
  } catch (error) {
    console.error("Failed to load emails from localStorage", error)
  }
}

// ===== 3. Email Categorization =====

const CATEGORY_KEYWORDS = {
  work: [
    "meeting",
    "project",
    "deadline",
    "report",
    "business",
    "office",
    "team",
    "manager",
    "client",
    "proposal",
    "invoice",
    "contract",
    "homework",
    "quiz",
    "assignment",
    "smu",
    "application",
    "board",
  ],
  personal: [
    "family",
    "friend",
    "birthday",
    "vacation",
    "personal",
    "home",
    "doctor",
    "appointment",
    "bank",
    "insurance",
  ],
  promotions: [
    "sale",
    "discount",
    "offer",
    "deal",
    "coupon",
    "promotion",
    "limited time",
    "special",
    "save",
    "free shipping",
  ],
  social: [
    "facebook",
    "twitter",
    "instagram",
    "linkedin",
    "notification",
    "comment",
    "like",
    "share",
    "follow",
    "social",
  ],
}

const PRIORITY_KEYWORDS = {
  high: ["urgent", "asap", "important", "critical", "emergency", "deadline", "immediate", "priority"],
  medium: ["meeting", "project", "review", "update", "reminder", "follow up"],
  low: ["newsletter", "notification", "info", "fyi", "update"],
}

function categorizeEmail(email) {
  const content = `${email.subject} ${email.body}`.toLowerCase()

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => content.includes(keyword))) {
      return category
    }
  }

  return "personal" // default category
}

function detectPriority(email) {
  const content = `${email.subject} ${email.body}`.toLowerCase()

  for (const [priority, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
    if (keywords.some((keyword) => content.includes(keyword))) {
      return priority
    }
  }

  return "medium" // default priority
}

// ===== 4. Theme Management =====

function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "light"
  state.settings.theme = savedTheme
  applyTheme(savedTheme)
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme)
  const themeIcon = document.querySelector("#theme-toggle i")
  themeIcon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon"
  localStorage.setItem("theme", theme)
}

function toggleTheme() {
  const newTheme = state.settings.theme === "light" ? "dark" : "light"
  state.settings.theme = newTheme
  applyTheme(newTheme)
}

// ===== 5. Email Management =====

async function loadEmails() {
  if (state.isLoading) return

  state.isLoading = true
  const refreshBtn = document.getElementById("refresh-btn")
  const icon = refreshBtn.querySelector("i")

  icon.classList.add("spin")
  refreshBtn.disabled = true

  try {
    const response = await fetch(`${API_BASE_URL}/messages`)
    if (!response.ok) throw new Error("Failed to fetch emails")

    const newEmails = await response.json()
    let newEmailCount = 0

    newEmails.forEach((email) => {
      const exists = state.emails.some((e) => e.id === (email.uid || email.id))
      if (!exists) {
        const transformedEmail = {
          id: email.uid || email.id,
          subject: email.subject || "(No Subject)",
          from: email.sender,
          date: email.receivedAt,
          body: email.body,
          summary: email.summary,
          isRead: true,
        }

        transformedEmail.category = categorizeEmail(transformedEmail)
        transformedEmail.priority = detectPriority(transformedEmail)

        state.emails.push(transformedEmail)
        newEmailCount++
      }
    })

    renderEmailList()
    updateStats()
    saveEmailsToLocal()

    showToast("Emails Loaded", `${newEmailCount} new emails added`)
  } catch (error) {
    console.error("Email fetch error:", error)
    showToast("Error", "Failed to load emails", "error")
  } finally {
    state.isLoading = false
    icon.classList.remove("spin")
    refreshBtn.disabled = false
  }
}

function filterEmails() {
  let filteredEmails = [...state.emails]

  if (state.activeCategory !== "all") {
    filteredEmails = filteredEmails.filter((email) => email.category === state.activeCategory)
  }

  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase()
    filteredEmails = filteredEmails.filter(
      (email) =>
        email.subject.toLowerCase().includes(query) ||
        email.from.toLowerCase().includes(query) ||
        email.body.toLowerCase().includes(query),
    )
  }

  if (state.filterType === "summarized") {
    filteredEmails = filteredEmails.filter((email) => email.summary)
  } else if (state.filterType === "unsummarized") {
    filteredEmails = filteredEmails.filter((email) => !email.summary)
  }

  return filteredEmails
}

function renderEmailList() {
  const emailList = document.getElementById("email-list")
  const filteredEmails = filterEmails()

  // Apply view mode class
  emailList.className = `email-list ${state.settings.viewMode === "card" ? "card-view" : ""}`

  emailList.innerHTML = ""

  if (filteredEmails.length === 0) {
    emailList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox fa-2x"></i>
        <p>No emails found</p>
      </div>
    `
    return
  }

  filteredEmails.forEach((email) => {
    const emailItem = document.createElement("div")
    emailItem.className = `email-item ${!email.isRead ? "unread" : ""} ${email.priority}-priority ${state.selectedEmail?.id === email.id ? "selected" : ""}`
    emailItem.dataset.emailId = email.id

    // Create preview text from body
    const preview = email.body ? email.body.substring(0, 120) + "..." : ""

    emailItem.innerHTML = `
      <div class="email-header">
        <div style="flex: 1; min-width: 0;">
          <div class="email-subject">${email.subject}</div>
          <div class="email-from">From: ${email.from}</div>
        </div>
      </div>
      <div class="email-preview">${preview}</div>
      <div class="email-meta">
        <span class="email-date">${formatDate(email.date)}</span>
        <div class="email-badges">
          <span class="priority-badge ${email.priority}">
            <i class="fas ${email.priority === "high" ? "fa-exclamation-triangle" : email.priority === "medium" ? "fa-exclamation-circle" : "fa-info-circle"}"></i>
            ${email.priority.charAt(0).toUpperCase() + email.priority.slice(1)}
          </span>
          <span class="category-badge ${email.category}">
            <i class="fas ${getCategoryIcon(email.category)}"></i>
            ${email.category.charAt(0).toUpperCase() + email.category.slice(1)}
          </span>
          <button class="auto-reply-btn" data-email-id="${email.id}">
            <i class="fas fa-reply"></i> Auto Reply
          </button>
          ${email.summary ? '<span class="summarized-badge"><i class="fas fa-bolt"></i> Summarized</span>' : ""}
        </div>
      </div>
    `

    emailItem.addEventListener("click", (e) => {
      // Don't select email if clicking on auto-reply button
      if (!e.target.closest(".auto-reply-btn")) {
        selectEmail(email.id)
      }
    })
    emailList.appendChild(emailItem)
  })

  updateEmailCount(filteredEmails.length)
}

function getCategoryIcon(category) {
  const icons = {
    personal: "fa-user",
    work: "fa-briefcase",
    promotions: "fa-tag",
    social: "fa-users",
  }
  return icons[category] || "fa-envelope"
}

function selectEmail(emailId) {
  const email = state.emails.find((e) => e.id == emailId)
  if (!email) return

  state.selectedEmail = email
  renderEmailList() // Re-render to update selection
  renderEmailDetail()
}

function renderEmailDetail() {
  const emailDetail = document.getElementById("email-detail")

  if (!state.selectedEmail) {
    emailDetail.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-envelope fa-3x"></i>
        <p>Select an email to view details</p>
      </div>
    `
    return
  }

  const email = state.selectedEmail

  emailDetail.innerHTML = `
    <div class="email-detail-header">
      <div class="email-detail-title">
        <span>${email.subject}</span>
      </div>
      <div class="email-detail-meta">
        <div><strong>From:</strong> ${email.from}</div>
        <div><strong>Date:</strong> ${formatDate(email.date)}</div>
      </div>
      <div class="email-detail-badges">
        <span class="priority-badge ${email.priority}">
          <i class="fas ${email.priority === "high" ? "fa-exclamation-triangle" : email.priority === "medium" ? "fa-exclamation-circle" : "fa-info-circle"}"></i>
          ${email.priority.charAt(0).toUpperCase() + email.priority.slice(1)} Priority
        </span>
        <span class="category-badge ${email.category}">
          <i class="fas ${getCategoryIcon(email.category)}"></i>
          ${email.category.charAt(0).toUpperCase() + email.category.slice(1)}
        </span>
      </div>
    </div>
    
    <div class="email-content">
      <h4><i class="fas fa-envelope-open"></i> Original Email</h4>
      <div class="email-body">${email.body}</div>
    </div>
    
    ${
      email.summary
        ? `
        <div class="summary-section">
          <div class="summary-header">
            <h4><i class="fas fa-bolt"></i> AI Summary</h4>
            <button class="btn btn-outline" onclick="copyToClipboard('${email.summary.replace(/'/g, "\\'")}')">
              <i class="fas fa-copy"></i> Copy
            </button>
          </div>
          <div class="summary-content">${email.summary}</div>
          <div class="summary-actions">
            <button class="btn btn-outline" onclick="summarizeEmail('${email.id}', 'short')">
              <i class="fas fa-compress-alt"></i> Shorter
            </button>
            <button class="btn btn-outline" onclick="summarizeEmail('${email.id}', 'detailed')">
              <i class="fas fa-expand-alt"></i> More Detailed
            </button>
          </div>
        </div>
      `
        : `
        <div class="summary-section">
          <button class="btn btn-primary" onclick="summarizeEmail('${email.id}', 'normal')" ${state.isSummarizing ? "disabled" : ""} style="width: 100%;">
            <i class="fas ${state.isSummarizing ? "fa-spinner spin" : "fa-bolt"}"></i>
            ${state.isSummarizing ? "Summarizing..." : "Generate AI Summary"}
          </button>
        </div>
      `
    }

    <div class="ai-reply-section">
      <div class="ai-reply-header">
        <i class="fas fa-robot"></i>
        <h4>AI Auto-Reply</h4>
      </div>
      <button class="btn btn-primary" onclick="generateAutoReply('${email.id}')" ${state.isGeneratingReply ? "disabled" : ""} style="width: 100%;">
        <i class="fas ${state.isGeneratingReply ? "fa-spinner spin" : "fa-magic"}"></i>
        ${state.isGeneratingReply ? "Generating Reply..." : "Generate Auto Reply"}
      </button>
      <div id="auto-reply-output"></div>
    </div>
  `
}

// ===== 6. AI Auto-Reply Functions =====

async function generateAutoReply(emailId) {
  const email = state.emails.find((e) => e.id == emailId)
  if (!email || state.isGeneratingReply) return

  state.isGeneratingReply = true
  const replyOutput = document.getElementById("auto-reply-output")

  // Show loading state
  replyOutput.innerHTML = `
    <div class="loading-reply">
      <i class="fas fa-spinner fa-spin"></i>
      <span>AI is crafting your reply...</span>
    </div>
  `

  // Update button state
  renderEmailDetail()

  try {
    const response = await fetch(`${API_BASE_URL}/api/ai-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: email.subject,
        body: email.body,
        from: email.from,
      }),
    })

    if (!response.ok) throw new Error("Failed to generate reply")

    const data = await response.json()
    if (!data.replyText) throw new Error("No reply text received")

    // Display the generated reply in a beautiful bubble
    displayReplyBubble(data.replyText, email)
  } catch (error) {
    console.error("Auto-reply generation error:", error)
    replyOutput.innerHTML = `
      <div class="reply-status error">
        <i class="fas fa-exclamation-triangle"></i>
        <span>Failed to generate reply. Please try again.</span>
      </div>
    `
    showToast("Error", "Failed to generate auto-reply", "error")
  } finally {
    state.isGeneratingReply = false
  }
}

  function displayReplyBubble(replyText, email) {
    const replyOutput = document.getElementById("auto-reply-output");
  
    replyOutput.innerHTML = `
      <div class="reply-bubble">
        <div class="reply-bubble-header">
          <div class="reply-bubble-title">
            <i class="fas fa-paper-plane"></i>
            <span>Generated Reply</span>
          </div>
          <button class="copy-btn" onclick="copyToClipboard(\`${replyText.replace(/`/g, "\\`")}\`)">
            <i class="fas fa-copy"></i> Copy
          </button>
        </div>
  
        <div class="reply-content">
          <p id="reply-text-display">${escapeHTML(replyText)}</p>
          <textarea id="reply-text-edit" style="display:none;" class="reply-textarea">${replyText}</textarea>
        </div>
  
        <div class="reply-actions">
          <button class="send-reply-btn" id="send-reply-btn">
            <i class="fas fa-paper-plane"></i> Send Reply
          </button>
          <button class="edit-reply-btn" id="edit-reply-btn">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="cancel-edit-btn" id="cancel-edit-btn" style="display:none;">
            <i class="fas fa-times"></i> Cancel
          </button>
          <button class="shorter-btn" id="shorter-btn" style="
          background-color: #e5e7eb;  /* gris clair */
          color: #111827;             /* texte noir/gris foncé */
          border: 1px solid #d1d5db;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.3s ease;
        "
        onmouseover="this.style.backgroundColor='#d1d5db'"
        onmouseout="this.style.backgroundColor='#e5e7eb'"
        >
          <i class="fas fa-compress-alt"></i> Shorter
        </button>
        

        </div>
      </div>
    `;
  
    // ✅ Envoyer
    document.getElementById("send-reply-btn").onclick = function () {
      const isEditing = document.getElementById("reply-text-edit").style.display !== "none";
      const message = isEditing
        ? document.getElementById("reply-text-edit").value
        : document.getElementById("reply-text-display").innerText;
      sendAutoReply(email.from, `Re: ${email.subject}`, message);
    };
  
    // ✅ Éditer
    document.getElementById("edit-reply-btn").onclick = function () {
      document.getElementById("reply-text-display").style.display = "none";
      document.getElementById("reply-text-edit").style.display = "block";
      document.getElementById("edit-reply-btn").style.display = "none";
      document.getElementById("cancel-edit-btn").style.display = "inline-block";
    };
  
    // ✅ Annuler
    document.getElementById("cancel-edit-btn").onclick = function () {
      document.getElementById("reply-text-edit").style.display = "none";
      document.getElementById("reply-text-display").style.display = "block";
      document.getElementById("edit-reply-btn").style.display = "inline-block";
      document.getElementById("cancel-edit-btn").style.display = "none";
    };
  
    // ✅ Générer une réponse plus courte
    document.getElementById("shorter-btn").onclick = function () {
      generateShorterReply(email);
    };
  }




function editReply() {
  const replyDisplay = document.getElementById("reply-display")
  const currentText = replyDisplay.textContent

  replyDisplay.innerHTML = `
    <textarea class="reply-textarea" id="reply-textarea">${currentText}</textarea>
  `

  // Update actions
  const actionsDiv = replyDisplay.parentNode.querySelector(".reply-actions")
  const email = state.selectedEmail

  actionsDiv.innerHTML = `
    <button class="send-reply-btn" onclick="saveAndSendReply('${email.from}', 'Re: ${email.subject}')">
      <i class="fas fa-paper-plane"></i>
      Send Edited Reply
    </button>
    <button class="edit-reply-btn" onclick="cancelEdit(\`${currentText.replace(/`/g, "\\`")}\`)">
      <i class="fas fa-times"></i>
      Cancel
    </button>
  `
}

function cancelEdit(originalText) {
  const replyDisplay = document.getElementById("reply-display")
  replyDisplay.innerHTML = originalText

  // Restore original actions
  const actionsDiv = replyDisplay.parentNode.querySelector(".reply-actions")
  const email = state.selectedEmail

  actionsDiv.innerHTML = `
    <button class="send-reply-btn" onclick="sendAutoReply('${email.from}', 'Re: ${email.subject}', \`${originalText.replace(/`/g, "\\`")}\`)">
      <i class="fas fa-paper-plane"></i>
      Send Reply
    </button>
    <button class="edit-reply-btn" onclick="editReply()">
      <i class="fas fa-edit"></i>
      Edit Reply
    </button>
  `
}

function saveAndSendReply(to, subject) {
  const textarea = document.getElementById("reply-textarea")
  const editedText = textarea.value
  sendAutoReply(to, subject, editedText)
}

async function sendAutoReply(to, subject, replyText) {
  try {
    showToast("Sending...", "Your reply is being sent")

    const response = await fetch(`${API_BASE_URL}/api/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: to,
        subject: subject,
        replyText: replyText,
      }),
    })

    if (!response.ok) throw new Error("Failed to send reply")

    // Show success status
    const replyOutput = document.getElementById("auto-reply-output")
    const statusDiv = document.createElement("div")
    statusDiv.className = "reply-status success"
    statusDiv.innerHTML = `
      <i class="fas fa-check-circle"></i>
      <span>Reply sent successfully to ${to}</span>
    `
    replyOutput.appendChild(statusDiv)

    showToast("Success!", "Auto-reply sent successfully ✅")
  } catch (error) {
    console.error("Send reply error:", error)

    const replyOutput = document.getElementById("auto-reply-output")
    const statusDiv = document.createElement("div")
    statusDiv.className = "reply-status error"
    statusDiv.innerHTML = `
      <i class="fas fa-exclamation-triangle"></i>
      <span>Failed to send reply. Please try again.</span>
    `
    replyOutput.appendChild(statusDiv)

    showToast("Error", "Failed to send reply", "error")
  }
}

// ===== 7. AI Summarization =====

async function summarizeEmail(emailId, style = "normal") {
  const email = state.emails.find((e) => e.id == emailId)
  if (!email || state.isSummarizing) return

  state.isSummarizing = true
  renderEmailDetail() // Update UI to show loading state

  try {
    const response = await fetch(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: email.body,
        model: state.settings.model,
        style: style,
      }),
    })

    if (!response.ok) {
      throw new Error("Failed to summarize email")
    }

    const data = await response.json()

    // Update email with summary
    email.summary = data.summary

    // Update UI
    renderEmailList()
    renderEmailDetail()
    updateStats()

    showToast("Email Summarized", `Summary generated using ${state.settings.model}`)
  } catch (error) {
    console.error("Summarization error:", error)
    showToast("Summarization Failed", "Please check if your AI server is running", "error")
  } finally {
    state.isSummarizing = false
    saveEmailsToLocal()
  }
}

// ===== 8. Bulk Operations =====

async function summarizeAllEmails() {
  if (state.isBulkSummarizing) return

  const unsummarizedEmails = state.emails.filter((email) => !email.summary)

  if (unsummarizedEmails.length === 0) {
    showToast("No Action Needed", "All emails are already summarized")
    return
  }

  state.isBulkSummarizing = true
  state.bulkProgress.current = 0
  state.bulkProgress.total = unsummarizedEmails.length

  // Show progress UI
  const progressContainer = document.getElementById("progress-container")
  const summarizeBtn = document.getElementById("summarize-all-btn")
  const progressFill = document.getElementById("progress-fill")
  const progressText = document.getElementById("progress-text")

  progressContainer.classList.remove("hidden")
  summarizeBtn.disabled = true
  summarizeBtn.innerHTML = '<i class="fas fa-spinner spin"></i> Summarizing...'

  updateProgress()

  try {
    for (let i = 0; i < unsummarizedEmails.length; i++) {
      const email = unsummarizedEmails[i]

      try {
        const response = await fetch(`${API_BASE_URL}/summarize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: email.body,
            model: state.settings.model,
            style: "normal",
          }),
        })

        if (response.ok) {
          const data = await response.json()
          email.summary = data.summary
        }
      } catch (error) {
        console.error(`Failed to summarize email ${email.id}:`, error)
      }

      state.bulkProgress.current = i + 1
      updateProgress()

      // Small delay to prevent overwhelming the server
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Update UI
    renderEmailList()
    if (state.selectedEmail) {
      renderEmailDetail()
    }
    updateStats()

    showToast("Bulk Summarization Complete", `Summarized ${state.bulkProgress.current} emails successfully`)
  } catch (error) {
    console.error("Bulk summarization error:", error)
    showToast("Bulk Summarization Failed", "Some emails could not be summarized", "error")
  } finally {
    state.isBulkSummarizing = false
    progressContainer.classList.add("hidden")
    summarizeBtn.disabled = false
    summarizeBtn.innerHTML = '<i class="fas fa-magic"></i> Summarize All'
    saveEmailsToLocal()
  }
}

function updateProgress() {
  const progressFill = document.getElementById("progress-fill")
  const progressText = document.getElementById("progress-text")

  const percentage = (state.bulkProgress.current / state.bulkProgress.total) * 100
  progressFill.style.width = `${percentage}%`
  progressText.textContent = `${state.bulkProgress.current}/${state.bulkProgress.total} emails processed`
}

// ===== 9. UI Helper Functions =====

function updateEmailCount(count = null) {
  const displayCount = count !== null ? count : state.emails.length
  document.getElementById("email-count").textContent = `${displayCount} email${displayCount !== 1 ? "s" : ""}`
}

function updateStats() {
  const totalEmails = state.emails.length
  const summarizedEmails = state.emails.filter((email) => email.summary).length
  const priorityEmails = state.emails.filter((email) => email.priority === "high").length
  const lastUpdate = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })

  document.getElementById("total-emails").textContent = totalEmails
  document.getElementById("summarized-emails").textContent = summarizedEmails
  document.getElementById("priority-emails").textContent = priorityEmails
  document.getElementById("last-update").textContent = lastUpdate
}

function markAllAsRead() {
  state.emails.forEach((email) => {
    email.isRead = true
  })
  renderEmailList()
  showToast("Emails Updated", "All emails marked as read")
}

function setActiveCategory(category) {
  state.activeCategory = category

  // Update tab states
  document.querySelectorAll(".category-tab").forEach((tab) => {
    tab.classList.remove("active")
  })
  document.querySelector(`[data-category="${category}"]`).classList.add("active")

  renderEmailList()
}

function setViewMode(mode) {
  state.settings.viewMode = mode
  localStorage.setItem("viewMode", mode)

  // Update button states
  document.querySelectorAll(".view-btn").forEach((btn) => {
    btn.classList.remove("active")
  })
  document.getElementById(`${mode}-view`).classList.add("active")

  // Re-render email list
  renderEmailList()
}

function handleSearch() {
  const searchInput = document.getElementById("search-input")
  state.searchQuery = searchInput.value
  renderEmailList()
}

function handleFilter() {
  const filterSelect = document.getElementById("filter-select")
  state.filterType = filterSelect.value
  renderEmailList()
}

// ===== 10. Event Listeners =====

function initEventListeners() {
  // Theme toggle
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme)

  // Refresh emails
  document.getElementById("refresh-btn").addEventListener("click", () => {
    if (confirm("Do you want to refresh and load new emails?")) {
      loadEmails()
    }
  })

  // Model selection
  document.getElementById("model-select").addEventListener("change", (e) => {
    state.settings.model = e.target.value
    localStorage.setItem("selectedModel", e.target.value)
  })

  // View mode toggles
  document.getElementById("list-view").addEventListener("click", () => setViewMode("list"))
  document.getElementById("card-view").addEventListener("click", () => setViewMode("card"))

  // Search and filter
  document.getElementById("search-input").addEventListener("input", handleSearch)
  document.getElementById("filter-select").addEventListener("change", handleFilter)

  // Category tabs
  document.querySelectorAll(".category-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setActiveCategory(tab.dataset.category)
    })
  })

  // Bulk actions
  document.getElementById("summarize-all-btn").addEventListener("click", summarizeAllEmails)
  document.getElementById("mark-all-read-btn").addEventListener("click", markAllAsRead)

  // Auto-reply button delegation
  document.addEventListener("click", (e) => {
    if (e.target.closest(".auto-reply-btn")) {
      const emailId = e.target.closest(".auto-reply-btn").dataset.emailId
      const email = state.emails.find((e) => e.id == emailId)
      if (email) {
        selectEmail(emailId)
        // Small delay to ensure email detail is rendered
        setTimeout(() => generateAutoReply(emailId), 100)
      }
    }
  })

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "r":
          e.preventDefault()
          loadEmails()
          break
        case "d":
          e.preventDefault()
          toggleTheme()
          break
        case "/":
          e.preventDefault()
          document.getElementById("search-input").focus()
          break
        case "s":
          e.preventDefault()
          if (!state.isBulkSummarizing) {
            summarizeAllEmails()
          }
          break
      }
    }
  })
}

// ===== 11. App Initialization =====

function init() {
  initTheme()

  // Load saved settings
  const savedModel = localStorage.getItem("selectedModel")
  if (savedModel) {
    state.settings.model = savedModel
    document.getElementById("model-select").value = savedModel
  }

  const savedViewMode = localStorage.getItem("viewMode")
  if (savedViewMode) {
    state.settings.viewMode = savedViewMode
    setViewMode(savedViewMode)
  }

  loadEmailsFromLocal()
  initEventListeners()
  loadEmails()
}

// ===== 12. Background Tasks =====

// Auto-refresh emails every 5 minutes
setInterval(
  () => {
    if (!state.isLoading && !state.isSummarizing && !state.isBulkSummarizing && !state.isGeneratingReply) {
      loadEmails()
    }
  },
  5 * 60 * 1000,
)

// Start the application
document.addEventListener("DOMContentLoaded", init)


function toggleReplyText() {
  const el = document.getElementById("reply-display");
  if (el) {
    el.style.display = el.style.display === "none" ? "block" : "none";
  }
}
function escapeHTML(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function generateShorterReply(email) {
  fetch('http://localhost:3001/api/ai-reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: email.subject,
      body: email.body,
      from: email.from,
      shorter: true  // <-- Tu peux gérer ce flag dans ton backend
    })
  })
    .then(res => res.json())
    .then(data => {
      if (data.replyText) {
        displayReplyBubble(data.replyText, email); // Réinjecte dans la carte
      }
    })
    .catch(err => {
      showToast("Erreur", "Impossible de générer une réponse courte.");
      console.error(err);
    });
}
