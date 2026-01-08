import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Form, Input, Button, Card, Typography, Space, Divider, ConfigProvider } from 'antd'
import { UserOutlined, LockOutlined, LoginOutlined } from '@ant-design/icons'
import { notifyError, notifySuccess } from './lib/notifications.js'

const { Title, Text } = Typography
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const BRAND = {
  primary: '#A97E34'
}

export default function Login() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const onFinish = async (values) => {
    setLoading(true)
    try {
      const resp = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      const data = await resp.json()
      if (!resp.ok) {
        notifyError(data || { message: 'Login failed' })
        return
      }
      const access = data.accessToken || data.token
      if (!access) {
        notifyError('No access token in response')
        return
      }
      localStorage.setItem('auth_token', access)
      if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken)
      localStorage.setItem('auth_user', JSON.stringify(data.user))
      notifySuccess('Logged in successfully')
      navigate('/')
    } catch (e) {
      notifyError(e, 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: BRAND.primary,
          borderRadius: 12,
        },
      }}
    >
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img 
              src="/logo.svg" 
              alt="Logo" 
              className="h-16 mx-auto mb-4" 
              onError={(e) => { e.target.src = 'https://via.placeholder.com/150?text=Uptown'; }}
            />
            <Title level={2} className="m-0">Welcome Back</Title>
            <Text type="secondary">Please enter your details to sign in</Text>
          </div>

          <Card className="shadow-xl border-none rounded-2xl">
            <Form
              name="login"
              layout="vertical"
              onFinish={onFinish}
              autoComplete="off"
              size="large"
            >
              <Form.Item
                label="Email"
                name="email"
                rules={[
                  { required: true, message: 'Please input your email!' },
                  { type: 'email', message: 'Please enter a valid email!' }
                ]}
              >
                <Input prefix={<UserOutlined className="text-gray-400" />} placeholder="your@email.com" />
              </Form.Item>

              <Form.Item
                label="Password"
                name="password"
                rules={[{ required: true, message: 'Please input your password!' }]}
              >
                <Input.Password prefix={<LockOutlined className="text-gray-400" />} placeholder="••••••••" />
              </Form.Item>

              <Form.Item className="mb-0">
                <Button 
                  type="primary" 
                  htmlType="submit" 
                  loading={loading} 
                  block 
                  icon={<LoginOutlined />}
                  className="h-12 text-lg font-semibold"
                >
                  Sign In
                </Button>
              </Form.Item>
            </Form>

            <Divider plain><Text type="secondary" className="text-xs">OR</Text></Divider>

            <div className="text-center">
              <Text type="secondary">Don't have an account? </Text>
              <Link to="/register" className="font-semibold text-primary hover:underline">
                Register Now
              </Link>
            </div>
          </Card>
          
          <div className="text-center mt-8">
            <Text type="secondary" className="text-xs">
              © {new Date().getFullYear()} Uptown Financial System. All rights reserved.
            </Text>
          </div>
        </div>
      </div>
    </ConfigProvider>
  )
}
