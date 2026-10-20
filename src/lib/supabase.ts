import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export type OrderRecord = {
  id: string;
  customer_name: string;
  device_id: string;
  status: "New" | "Printing" | "Ready" | "Completed";
  total_amount: number;
  pickup_area: string;
  pickup_location: string;
  print_mode: string;
  sides: string;
  stapling: string;
  binding: string;
  copies: number;
  created_at: string;
};

export type OrderDocumentRecord = {
  id: string;
  order_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  total_pages: number;
  color_pages: number;
  bw_pages: number;
  selected_pages: string;
  created_at: string;
  download_url?: string;
};

export async function syncDeviceSession(deviceId: string, userName: string) {
  if (!supabase) return;
  try {
    await supabase.from("device_sessions").upsert(
      {
        device_id: deviceId,
        user_name: userName,
        last_active_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    );
  } catch (err) {
    console.warn("Failed to sync device session to Supabase:", err);
  }
}

export async function fetchDeviceUserName(deviceId: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase
      .from("device_sessions")
      .select("user_name")
      .eq("device_id", deviceId)
      .maybeSingle();
    return data?.user_name ?? null;
  } catch {
    return null;
  }
}

export async function uploadOrderFile(orderId: string, file: File): Promise<string | null> {
  if (!supabase) return null;
  try {
    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${orderId}/${Date.now()}_${cleanFileName}`;
    const { error } = await supabase.storage
      .from("print-documents")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.warn("Supabase storage upload error:", error);
      return null;
    }
    return filePath;
  } catch (err) {
    console.warn("Error uploading file to Supabase:", err);
    return null;
  }
}

export async function getDocumentSignedUrl(filePath: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage
      .from("print-documents")
      .createSignedUrl(filePath, 3600); // 1 hour valid
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
