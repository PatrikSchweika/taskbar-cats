// Win32 shell facts the cats need, and nothing else.
//
// This addon is deliberately incurious. It reports what the shell says —
// taskbar rect, every button on it, the notification area's extent, the cursor,
// which window is in front and how big it is — and makes no decisions about
// which buttons are app icons, whether that window counts as fullscreen, or
// where a cat may walk. That policy lives in taskbarTracker.ts, where it can be
// unit-tested against fixtures on any OS.
//
// Everything here is in *physical* pixels. Electron works in device-independent
// pixels, so main.ts converts through `screen.screenToDipRect`.

#include <napi.h>

#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <uiautomation.h>

#include <string>
#include <vector>

namespace {

std::string ToUtf8(const wchar_t* value, int wide_len) {
  if (value == nullptr || wide_len <= 0) return std::string();
  const int len = WideCharToMultiByte(CP_UTF8, 0, value, wide_len, nullptr, 0,
                                      nullptr, nullptr);
  if (len <= 0) return std::string();
  std::string out(static_cast<size_t>(len), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, wide_len, out.data(), len, nullptr,
                      nullptr);
  return out;
}

std::string ToUtf8(BSTR value) {
  if (value == nullptr) return std::string();
  return ToUtf8(value, static_cast<int>(SysStringLen(value)));
}

/** A BSTR that releases itself. */
class ScopedBstr {
 public:
  ScopedBstr() = default;
  ~ScopedBstr() {
    if (value_ != nullptr) SysFreeString(value_);
  }
  ScopedBstr(const ScopedBstr&) = delete;
  ScopedBstr& operator=(const ScopedBstr&) = delete;

  BSTR* Receive() { return &value_; }
  std::string Utf8() const { return ToUtf8(value_); }

 private:
  BSTR value_ = nullptr;
};

template <typename T>
void SafeRelease(T** ptr) {
  if (*ptr != nullptr) {
    (*ptr)->Release();
    *ptr = nullptr;
  }
}

Napi::Object RectToJs(const Napi::Env& env, const RECT& rc) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("x", Napi::Number::New(env, rc.left));
  out.Set("y", Napi::Number::New(env, rc.top));
  out.Set("w", Napi::Number::New(env, rc.right - rc.left));
  out.Set("h", Napi::Number::New(env, rc.bottom - rc.top));
  return out;
}

const char* EdgeName(UINT edge) {
  switch (edge) {
    case ABE_LEFT:
      return "left";
    case ABE_TOP:
      return "top";
    case ABE_RIGHT:
      return "right";
    default:
      return "bottom";
  }
}

// -- UI Automation ----------------------------------------------------------
//
// One IUIAutomation instance is kept for the life of the process. It is bound to
// the apartment of the thread that created it, and every call arrives on
// Electron's main thread, so a single cached instance is correct.

IUIAutomation* g_automation = nullptr;

bool EnsureAutomation() {
  if (g_automation != nullptr) return true;

  // S_FALSE means this thread was already initialised, and RPC_E_CHANGED_MODE
  // that Chromium got here first with a different model. Both are fine: we only
  // need *an* apartment, not ours.
  const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(init) && init != RPC_E_CHANGED_MODE) return false;

  const HRESULT hr =
      CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                       IID_PPV_ARGS(&g_automation));
  if (FAILED(hr)) {
    g_automation = nullptr;
    return false;
  }
  return true;
}

/**
 * The runtime id as a string, so JavaScript can tell one button from another
 * across polls without holding a COM pointer.
 *
 * A taskbar reflow moves buttons and an app relaunch replaces them, so position
 * is not identity; the runtime id is the only thing UIA offers that is stable
 * for exactly as long as the element lives.
 */
std::string RuntimeIdOf(IUIAutomationElement* element) {
  VARIANT var;
  VariantInit(&var);
  if (FAILED(element->GetCachedPropertyValue(UIA_RuntimeIdPropertyId, &var)))
    return std::string();

  std::string out;
  if (var.vt == (VT_ARRAY | VT_I4) && var.parray != nullptr) {
    LONG lower = 0;
    LONG upper = -1;
    SafeArrayGetLBound(var.parray, 1, &lower);
    SafeArrayGetUBound(var.parray, 1, &upper);
    for (LONG i = lower; i <= upper; i++) {
      LONG value = 0;
      if (SUCCEEDED(SafeArrayGetElement(var.parray, &i, &value))) {
        if (!out.empty()) out.push_back('.');
        out.append(std::to_string(value));
      }
    }
  }
  VariantClear(&var);
  return out;
}

/**
 * Every button on the primary taskbar, with the metadata JavaScript needs to
 * decide which ones are app icons.
 *
 * One cached FindAll rather than a property read per element: each uncached
 * property is a cross-process call, and the taskbar can hold thirty buttons.
 */
Napi::Value GetTaskbarButtons(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env);
  if (!EnsureAutomation()) return out;

  HWND tray = FindWindowW(L"Shell_TrayWnd", nullptr);
  if (tray == nullptr) return out;

  IUIAutomationElement* root = nullptr;
  if (FAILED(g_automation->ElementFromHandle(tray, &root)) || root == nullptr)
    return out;

  IUIAutomationCondition* condition = nullptr;
  VARIANT button_type;
  VariantInit(&button_type);
  button_type.vt = VT_I4;
  button_type.lVal = UIA_ButtonControlTypeId;
  HRESULT hr = g_automation->CreatePropertyCondition(
      UIA_ControlTypePropertyId, button_type, &condition);
  VariantClear(&button_type);
  if (FAILED(hr) || condition == nullptr) {
    SafeRelease(&root);
    return out;
  }

  IUIAutomationCacheRequest* cache = nullptr;
  if (FAILED(g_automation->CreateCacheRequest(&cache)) || cache == nullptr) {
    SafeRelease(&condition);
    SafeRelease(&root);
    return out;
  }
  cache->AddProperty(UIA_BoundingRectanglePropertyId);
  cache->AddProperty(UIA_AutomationIdPropertyId);
  cache->AddProperty(UIA_ClassNamePropertyId);
  cache->AddProperty(UIA_NamePropertyId);
  cache->AddProperty(UIA_RuntimeIdPropertyId);
  cache->put_AutomationElementMode(AutomationElementMode_None);

  IUIAutomationElementArray* found = nullptr;
  hr = root->FindAllBuildCache(TreeScope_Descendants, condition, cache, &found);
  SafeRelease(&cache);
  SafeRelease(&condition);
  SafeRelease(&root);
  if (FAILED(hr) || found == nullptr) return out;

  int count = 0;
  found->get_Length(&count);
  uint32_t written = 0;
  for (int i = 0; i < count; i++) {
    IUIAutomationElement* element = nullptr;
    if (FAILED(found->GetElement(i, &element)) || element == nullptr) continue;

    RECT rc = {0, 0, 0, 0};
    if (SUCCEEDED(element->get_CachedBoundingRectangle(&rc))) {
      ScopedBstr automation_id;
      ScopedBstr class_name;
      ScopedBstr name;
      element->get_CachedAutomationId(automation_id.Receive());
      element->get_CachedClassName(class_name.Receive());
      element->get_CachedName(name.Receive());

      Napi::Object item = RectToJs(env, rc);
      item.Set("automationId", Napi::String::New(env, automation_id.Utf8()));
      item.Set("className", Napi::String::New(env, class_name.Utf8()));
      item.Set("name", Napi::String::New(env, name.Utf8()));
      item.Set("id", Napi::String::New(env, RuntimeIdOf(element)));
      out.Set(written++, item);
    }
    SafeRelease(&element);
  }
  SafeRelease(&found);
  return out;
}

// -- plain Win32 ------------------------------------------------------------

/** The primary taskbar's rect, which edge it is docked to, and its auto-hide state. */
Napi::Value GetTaskbar(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  APPBARDATA abd;
  ZeroMemory(&abd, sizeof(abd));
  abd.cbSize = sizeof(abd);
  if (SHAppBarMessage(ABM_GETTASKBARPOS, &abd) == 0) return env.Null();

  APPBARDATA state_query;
  ZeroMemory(&state_query, sizeof(state_query));
  state_query.cbSize = sizeof(state_query);
  const UINT_PTR state = SHAppBarMessage(ABM_GETSTATE, &state_query);

  Napi::Object out = RectToJs(env, abd.rc);
  out.Set("edge", Napi::String::New(env, EdgeName(abd.uEdge)));
  out.Set("autoHide",
          Napi::Boolean::New(env, (state & ABS_AUTOHIDE) == ABS_AUTOHIDE));
  return out;
}

/**
 * The notification area's rect, so the clock and tray icons are not mistaken
 * for app buttons. Null when it cannot be found, which JavaScript treats as
 * "exclude nothing".
 */
Napi::Value GetNotificationArea(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND tray = FindWindowW(L"Shell_TrayWnd", nullptr);
  if (tray == nullptr) return env.Null();
  HWND notify = FindWindowExW(tray, nullptr, L"TrayNotifyWnd", nullptr);
  if (notify == nullptr) return env.Null();
  RECT rc;
  if (GetWindowRect(notify, &rc) == 0) return env.Null();
  return RectToJs(env, rc);
}

Napi::Value GetCursorPosition(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  POINT p;
  if (GetCursorPos(&p) == 0) return env.Null();
  Napi::Object out = Napi::Object::New(env);
  out.Set("x", Napi::Number::New(env, p.x));
  out.Set("y", Napi::Number::New(env, p.y));
  return out;
}

/**
 * The foreground window: its class, its rect, the monitor it is on, and
 * whether DWM is cloaking it. Null when there is no foreground window.
 *
 * Whether that adds up to a fullscreen app the cats should hide from is
 * decided in taskbarTracker.ts. The shell's own monitor-sized surfaces — the
 * Start menu, the notification centre, tray flyouts — look exactly like a game
 * from here, and telling them apart is a policy about the shell that belongs
 * where it can be tested against fixtures.
 */
Napi::Value GetForeground(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HWND fg = GetForegroundWindow();
  if (fg == nullptr) return env.Null();

  RECT window_rect;
  if (GetWindowRect(fg, &window_rect) == 0) return env.Null();

  HMONITOR monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
  MONITORINFO mi;
  ZeroMemory(&mi, sizeof(mi));
  mi.cbSize = sizeof(mi);
  if (GetMonitorInfoW(monitor, &mi) == 0) return env.Null();

  wchar_t class_name[256] = {0};
  const int class_len = GetClassNameW(fg, class_name, 256);

  // Cloaked means DWM is not drawing it — suspended, or still animating in —
  // however large its rect says it is.
  DWORD cloaked = 0;
  if (FAILED(DwmGetWindowAttribute(fg, DWMWA_CLOAKED, &cloaked,
                                   sizeof(cloaked))))
    cloaked = 0;

  Napi::Object out = RectToJs(env, window_rect);
  out.Set("className", Napi::String::New(env, ToUtf8(class_name, class_len)));
  out.Set("monitor", RectToJs(env, mi.rcMonitor));
  out.Set("cloaked", Napi::Boolean::New(env, cloaked != 0));
  return out;
}

Napi::Value Dispose(const Napi::CallbackInfo& info) {
  SafeRelease(&g_automation);
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("taskbar", Napi::Function::New(env, GetTaskbar));
  exports.Set("taskbarButtons", Napi::Function::New(env, GetTaskbarButtons));
  exports.Set("notificationArea",
              Napi::Function::New(env, GetNotificationArea));
  exports.Set("cursor", Napi::Function::New(env, GetCursorPosition));
  exports.Set("foreground", Napi::Function::New(env, GetForeground));
  exports.Set("dispose", Napi::Function::New(env, Dispose));
  return exports;
}

}  // namespace

NODE_API_MODULE(win32_shell, Init)
