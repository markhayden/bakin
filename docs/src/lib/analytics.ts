export type AnalyticsEvent =
  | {
      event: "page_view_custom";
      page_path: string;
      page_title: string;
      page_location: string;
    }
  | {
      event: "cta_click";
      cta_name: string;
      cta_label: string;
      page_path: string;
      page_section?: string;
    }
  | {
      event: "outbound_click";
      outbound_url: string;
      link_label: string;
      page_path: string;
    }
  | {
      event: "scroll_depth";
      scroll_depth: 25 | 50 | 75 | 100;
      page_path: string;
    }
  | {
      event: "ui_modal_open";
      modal_source: string;
    }
  | {
      event: "form_submit";
      form_name: "contact";
      page_path?: string;
    }
  | {
      event: "content_tab_select";
      tab_group: string;
      tab_id: string;
    }
  | {
      event: "consent_update";
      analytics_storage: "granted" | "denied";
      ad_storage: "granted" | "denied";
      source: "default" | "accept" | "reject" | "restore" | "dismiss";
    };

export const track = (payload: AnalyticsEvent): void => {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(payload);
};
