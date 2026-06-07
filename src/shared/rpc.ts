// Typed RPC contract shared by the Bun main process and the webview.
//
// Electrobun semantics (verified against electrobun@1.18.1):
//   - `bun.requests`     : handled by Bun,     called by the webview.
//   - `webview.requests` : handled by webview, called by Bun.
//   - `bun.messages`     : sent by webview,    received by Bun.
//   - `webview.messages` : sent by Bun,        received by webview.
//
// So `workingTreeChanged` lives under `webview.messages`: Bun pushes it via
// `rpc.send.workingTreeChanged()` and the webview handles it.

import type { AnnotationSide, Comment, CompareSpec, ReviewModel, SetRepoResult, SupervisionConfig } from './types';

export type SupervisionRPC = {
  bun: {
    requests: {
      getRepoRoot: {
        params: undefined;
        response: {
          root: string;
          isRepo: boolean;
        };
      };
      getReview: {
        params: {
          compare: CompareSpec;
        };
        response: ReviewModel;
      };
      stage: {
        params: {
          paths: string[];
        };
        response: ReviewModel;
      }; // approve
      unstage: {
        params: {
          paths: string[];
        };
        response: ReviewModel;
      };
      getComments: {
        params: undefined;
        response: Comment[];
      };
      saveComment: {
        params: {
          path: string;
          line: number;
          side: AnnotationSide;
          endLine?: number;
          endSide?: AnnotationSide;
          body: string;
        };
        response: Comment[];
      };
      resolveComment: {
        params: {
          id: string;
        };
        response: Comment[];
      };
      deleteComment: {
        params: {
          id: string;
        };
        response: Comment[];
      };
      exportMarkdown: {
        params: undefined;
        response: {
          markdown: string;
          path: string;
        };
      };
      getConfig: {
        params: undefined;
        response: SupervisionConfig;
      };
      saveConfig: {
        params: SupervisionConfig;
        response: SupervisionConfig;
      };
      /** Point the app at `path`'s git root (recent click / programmatic). */
      setRepo: {
        params: {
          path: string;
        };
        response: SetRepoResult;
      };
      /** Open a native folder picker, then switch to the chosen repo. */
      openProject: {
        params: undefined;
        response: SetRepoResult;
      };
      /** Most-recently-opened repo roots, newest first. */
      getRecentProjects: {
        params: undefined;
        response: string[];
      };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      workingTreeChanged: undefined;
      /** A native menu item was clicked; `action` is the item's action id. */
      menuAction: {
        action: string;
      };
      /** The repo under review changed (recent click / Open Project…). Pushed
       * instead of relying on the RPC return, since the native folder dialog can
       * outlive the request timeout. */
      repoChanged: {
        root: string;
        recents: string[];
      };
    };
  };
};
