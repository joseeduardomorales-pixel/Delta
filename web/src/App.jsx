import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { ToastProvider } from './components/ui/index.js';
import Login from './routes/Login.jsx';
import Chat from './routes/Chat.jsx';
import AssetHistory from './routes/AssetHistory.jsx';
import InspectionRunner from './routes/InspectionRunner.jsx';
import ReviewQueue from './routes/admin/ReviewQueue.jsx';
import Users from './routes/admin/Users.jsx';
import PmSchedules from './routes/admin/PmSchedules.jsx';
import Campaigns from './routes/admin/Campaigns.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Chat />
                </RequireAuth>
              }
            />
            <Route
              path="/assets/:unit"
              element={
                <RequireAuth>
                  <AssetHistory />
                </RequireAuth>
              }
            />
            <Route
              path="/work-orders/:woId/inspect/:inspectionId"
              element={
                <RequireAuth>
                  <InspectionRunner />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/work-orders/pending"
              element={
                <RequireAuth requireRole="admin">
                  <ReviewQueue />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/users"
              element={
                <RequireAuth requireRole="admin">
                  <Users />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/pm-schedules"
              element={
                <RequireAuth requireRole="admin">
                  <PmSchedules />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/campaigns"
              element={
                <RequireAuth requireRole="admin">
                  <Campaigns />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
