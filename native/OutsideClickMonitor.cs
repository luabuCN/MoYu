using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// Only mouse button-down notifications are forwarded. No keyboard hook or input log.
internal static class OutsideClickMonitor
{
    private delegate IntPtr MouseHook(int code, IntPtr message, IntPtr data);
    private static readonly MouseHook Callback = OnMouse;
    private static readonly ConcurrentQueue<Click> Queue = new ConcurrentQueue<Click>();
    private static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    private static IntPtr hook;
    private static uint threadId;
    private static volatile bool stopping;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseData { public Point Position; public uint Data, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message { public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Position; public uint Private; }
    private struct Click { public int X, Y; public IntPtr Window; public long Time; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int id, MouseHook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr handle);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr handle, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern int GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint flags);
    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private static void Stop() { PostThreadMessage(threadId, 0x0012, UIntPtr.Zero, IntPtr.Zero); }

    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        long kind = message.ToInt64();
        if (code >= 0 && (kind == 0x0201 || kind == 0x0204 || kind == 0x0207 || kind == 0x020B) && Queue.Count < 128)
        {
            MouseData mouse = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
            Queue.Enqueue(new Click {
                X = mouse.Position.X, Y = mouse.Position.Y,
                Window = GetAncestor(WindowFromPoint(mouse.Position), 3),
                Time = (DateTime.UtcNow.Ticks - 621355968000000000L) / TimeSpan.TicksPerMillisecond
            });
            Wake.Set();
        }
        // Never swallow or delay the original click.
        return CallNextHookEx(hook, code, message, data);
    }

    private static void WriteClicks()
    {
        while (!stopping)
        {
            Wake.WaitOne();
            Click click;
            while (!stopping && Queue.TryDequeue(out click))
            {
                try
                {
                    Console.WriteLine("click\t{0}\t{1}\t{2}\t{3}", click.X, click.Y, click.Window.ToInt64().ToString("x"), click.Time);
                    Console.Out.Flush();
                }
                catch { Stop(); return; }
            }
        }
    }

    private static int Main(string[] args)
    {
        int parentId;
        if (args.Length != 1 || !int.TryParse(args[0], out parentId)) return 2;
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        threadId = GetCurrentThreadId();
        Message message;
        PeekMessage(out message, IntPtr.Zero, 0, 0, 0); // Create the thread's message queue before subscribing to parent exit.
        Process parent;
        try
        {
            parent = Process.GetProcessById(parentId);
            parent.EnableRaisingEvents = true;
            parent.Exited += delegate { Stop(); };
            if (parent.HasExited) return 0;
        }
        catch { return 0; }
        hook = SetWindowsHookEx(14, Callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.Error.WriteLine("Mouse hook failed: " + Marshal.GetLastWin32Error()); return 3; }
        try
        {
            Console.WriteLine("ready"); Console.Out.Flush();
            new Thread(WriteClicks) { IsBackground = true, Name = "Moyu mouse notifications" }.Start();
            new Thread(delegate() { try { Console.In.ReadLine(); } catch {} Stop(); }) { IsBackground = true }.Start();
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message); DispatchMessage(ref message);
            }
            return 0;
        }
        finally
        {
            stopping = true; Wake.Set();
            UnhookWindowsHookEx(hook); parent.Dispose();
        }
    }
}
