import { createBrowserRouter } from "react-router-dom";
import { CompetitorListPage, TimelinePage } from "@/app/pages";
import { Shell } from "@/app/Shell";
import { EmptyState } from "@/components/EmptyState";

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: <CompetitorListPage /> },
      { path: "/competitors/:id", element: <TimelinePage /> },
      { path: "*", element: <EmptyState title="Page not found" /> },
    ],
  },
]);
