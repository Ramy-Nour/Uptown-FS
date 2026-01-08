import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Menu, Button, Avatar, Dropdown, Badge, Space, Typography, ConfigProvider, theme } from 'antd';
import {
  MenuUnfoldOutlined,
  MenuFoldOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  CalculatorOutlined,
  TeamOutlined,
  FileTextOutlined,
  HistoryOutlined,
  SettingOutlined,
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import NotificationBell from '../notifications/NotificationBell.jsx';

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const BRAND = {
  primary: '#A97E34',
  primaryDark: '#8B672C'
};

const MainLayout = ({ children, title }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [planEditsCount, setPlanEditsCount] = useState(0);
  const [apiHealthy, setApiHealthy] = useState(null);
  
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    try {
      const raw = localStorage.getItem('auth_user');
      if (raw) setUser(JSON.parse(raw));
    } catch {}
  }, []);

  const handleLogout = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const rt = localStorage.getItem('refresh_token');
      if (rt) {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt })
        }).catch(() => {});
      }
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
  };

  // Navigation items based on role
  const menuItems = useMemo(() => {
    if (!user) return [];
    const role = user.role;
    const items = [];

    // Common items
    if (['property_consultant', 'sales_manager', 'financial_manager', 'financial_admin', 'crm_admin'].includes(role)) {
      items.push({
        key: '/deals/create',
        icon: <CalculatorOutlined />,
        label: 'Calculator',
      });
    }

    items.push({
      key: '/deals',
      icon: <DashboardOutlined />,
      label: 'Deals',
    });

    // Role specific items
    if (role === 'superadmin' || role === 'admin') {
      items.push({
        key: '/admin/users',
        icon: <TeamOutlined />,
        label: 'Users',
      });
      items.push({
        key: '/admin/units/bulk-create',
        icon: <AppstoreOutlined />,
        label: 'Bulk Units',
      });
      items.push({
        key: '/admin/unit-history',
        icon: <HistoryOutlined />,
        label: 'Unit History',
      });
    }

    if (role === 'sales_manager') {
      items.push({
        key: '/deals/queues',
        icon: <Badge count={queueCount} size="small" offset={[10, 0]}><FileTextOutlined /></Badge>,
        label: 'Queues',
      });
      items.push({
        key: '/deals/offer-progress',
        icon: <CheckCircleOutlined />,
        label: 'Offer Progress',
      });
    }

    if (role === 'financial_manager') {
      items.push({
        key: '/deals/queues',
        icon: <Badge count={queueCount} size="small" offset={[10, 0]}><FileTextOutlined /></Badge>,
        label: 'Queues',
      });
      items.push({
        key: '/admin/standard-pricing',
        icon: <SettingOutlined />,
        label: 'Standard Pricing',
      });
    }

    if (role === 'property_consultant') {
      items.push({
        key: '/deals/offer-progress',
        icon: <CheckCircleOutlined />,
        label: 'Offer Progress',
      });
      items.push({
        key: '/deals/my-proposals',
        icon: <FileTextOutlined />,
        label: 'My Proposals',
      });
    }

    if (['ceo', 'chairman', 'vice_chairman', 'top_management'].includes(role)) {
      items.push({
        key: '/deals/queues',
        icon: <Badge count={queueCount} size="small" offset={[10, 0]}><FileTextOutlined /></Badge>,
        label: 'Unit Model Queue',
      });
      items.push({
        key: '/admin/standard-pricing-approvals',
        icon: <CheckCircleOutlined />,
        label: 'Pricing Queue',
      });
      items.push({
        key: '/contracts',
        icon: <FileTextOutlined />,
        label: 'Contracts',
      });
    }

    return items;
  }, [user, queueCount]);

  const userMenu = (
    <Menu>
      <Menu.Item key="profile" icon={<UserOutlined />}>
        Profile
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item key="logout" icon={<LogoutOutlined />} onClick={handleLogout} danger>
        Logout
      </Menu.Item>
    </Menu>
  );

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: BRAND.primary,
          borderRadius: 8,
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          theme="light"
          className="shadow-md"
          width={260}
        >
          <div className="flex items-center justify-center py-6 px-4">
            <img 
              src="/logo.svg" 
              alt="Logo" 
              style={{ height: collapsed ? 32 : 48, transition: 'all 0.2s' }} 
              onError={(e) => { e.target.src = 'https://via.placeholder.com/150?text=Uptown'; }}
            />
          </div>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            className="border-none"
          />
        </Sider>
        <Layout>
          <Header className="bg-white p-0 flex items-center justify-between pr-6 shadow-sm">
            <div className="flex items-center">
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                className="text-lg w-16 h-16"
              />
              <Title level={4} className="m-0 ml-2 hidden sm:block">
                {title || 'Uptown Financial System'}
              </Title>
            </div>
            
            <Space size="large">
              <NotificationBell />
              <Dropdown overlay={userMenu} placement="bottomRight" arrow>
                <Space className="cursor-pointer hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors">
                  <Avatar icon={<UserOutlined />} style={{ backgroundColor: BRAND.primary }} />
                  <div className="hidden md:flex flex-col leading-tight">
                    <Text strong>{user?.name || 'User'}</Text>
                    <Text type="secondary" size="small" className="text-xs capitalize">
                      {user?.role?.replace(/_/g, ' ')}
                    </Text>
                  </div>
                </Space>
              </Dropdown>
            </Space>
          </Header>
          <Content className="m-6 p-6 bg-white rounded-xl shadow-sm overflow-auto">
            {children}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};

export default MainLayout;
