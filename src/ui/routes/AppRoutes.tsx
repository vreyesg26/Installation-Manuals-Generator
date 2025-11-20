import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "../App";
import StepsPage from "../pages/StepsPage";
import HomePage from "../pages/HomePage";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />

        <Route element={<Layout />}>
          <Route path="/import" element={<StepsPage />} />
          <Route path="/editor" element={<StepsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
