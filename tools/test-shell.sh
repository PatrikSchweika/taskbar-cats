#!/bin/bash
# Run taskbar-cats in a throwaway GNOME Shell that cannot touch your desktop.
#
# Uses `gnome-shell --headless --virtual-monitor`, its own D-Bus session, and
# its own dconf store (via XDG_CONFIG_HOME), so nothing here changes your live
# session's settings or extensions. XDG_DATA_HOME is left alone so the shell
# still finds the extension you installed with `make install`.
#
#   tools/test-shell.sh start [/dconf/key=value ...]
#   tools/test-shell.sh shot 3 out      # 3s screencast -> out000.png
#   tools/test-shell.sh log
#   tools/test-shell.sh stop
#
# Screenshots go through Screencast because the Screenshot D-Bus API refuses
# external callers.
set -u
DIR="${TMPDIR:-/tmp}/taskbar-cats-test"
mkdir -p "$DIR"
LOG="$DIR/shell.log"
BUS="$DIR/bus.env"
PIDFILE="$DIR/shell.pid"

# start() runs the shell under setsid, so it leads its own process group and we
# can signal exactly that group. Pattern matching (pkill -f) is not safe here:
# any caller whose own command line happens to mention the shell's arguments
# would match itself and get killed too.
stop() {
    if [ -f "$PIDFILE" ]; then
        pgid=$(cat "$PIDFILE")
        kill -TERM "-$pgid" 2>/dev/null
        sleep 1
        kill -KILL "-$pgid" 2>/dev/null
        rm -f "$PIDFILE"
    fi
    echo "stopped"
}

start() {
    rm -f "$LOG" "$BUS"
    export XDG_CONFIG_HOME="$DIR/config"
    export XDG_CACHE_HOME="$DIR/cache"
    rm -rf "$XDG_CONFIG_HOME"
    mkdir -p "$XDG_CONFIG_HOME"
    setsid dbus-run-session -- bash -c '
        dconf write /org/gnome/shell/disable-user-extensions false
        dconf write /org/gnome/shell/enabled-extensions \
            "[\"ubuntu-dock@ubuntu.com\",\"ubuntu-cats\"]"
        dconf write /org/gnome/shell/extensions/dash-to-dock/dock-position "\"BOTTOM\""
        dconf write /org/gnome/shell/extensions/dash-to-dock/dock-fixed true
        dconf write /org/gnome/shell/extensions/dash-to-dock/dash-max-icon-size 48
        dconf write /org/gnome/shell/favorite-apps \
            "[\"firefox_firefox.desktop\",\"org.gnome.Nautilus.desktop\",\"org.gnome.Terminal.desktop\",\"org.gnome.Calculator.desktop\"]"
        for kv in "$@"; do dconf write "${kv%%=*}" "${kv#*=}"; done
        echo "BUS=$DBUS_SESSION_BUS_ADDRESS" > "'"$BUS"'"
        exec gnome-shell --headless --virtual-monitor 1600x900 --wayland
    ' _ "$@" > "$LOG" 2>&1 &
    echo $! > "$PIDFILE"
    for _ in $(seq 1 40); do
        grep -q "GNOME Shell started" "$LOG" 2>/dev/null && break
        sleep 1
    done
    grep -q "GNOME Shell started" "$LOG" && echo "shell up ($DIR)" || {
        echo "shell FAILED to start; see $LOG"; exit 1; }
}

shot() {
    local secs="${1:-3}" out="${2:-frame}"
    export DBUS_SESSION_BUS_ADDRESS=$(sed 's/^BUS=//' "$BUS")
    rm -f "$DIR/cast.webm" "$DIR/$out"*.png
    gdbus call --session --dest org.gnome.Shell.Screencast \
        --object-path /org/gnome/Shell/Screencast \
        --method org.gnome.Shell.Screencast.Screencast \
        "$DIR/cast.webm" "{'draw-cursor': <false>, 'framerate': <10>}" >/dev/null
    sleep "$secs"
    gdbus call --session --dest org.gnome.Shell.Screencast \
        --object-path /org/gnome/Shell/Screencast \
        --method org.gnome.Shell.Screencast.StopScreencast >/dev/null 2>&1
    sleep 1
    gst-launch-1.0 -q filesrc location="$DIR/cast.webm" ! decodebin ! videoconvert \
        ! pngenc snapshot=false ! multifilesink location="$DIR/$out%03d.png" 2>/dev/null
    ls "$DIR/$out"*.png 2>/dev/null
}

case "${1:-}" in
    start)   shift; start "$@" ;;
    stop)    stop ;;
    restart) stop; shift; start "$@" ;;
    shot)    shift; shot "$@" ;;
    log)     tail -f "$LOG" ;;
    *) echo "usage: $0 start|stop|restart|shot <secs> <prefix>|log"; exit 1 ;;
esac
