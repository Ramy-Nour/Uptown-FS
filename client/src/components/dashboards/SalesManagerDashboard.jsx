import React, { useState, useEffect } from 'react'
import { Card, Row, Col, Statistic, Table, Tabs, Select, DatePicker, Button, Tag } from 'antd'
import { TeamOutlined, CheckCircleOutlined, ClockCircleOutlined, DollarOutlined, TrendingUpOutlined } from '@ant-design/icons'

const { TabPane } = Tabs
const { RangePicker } = DatePicker
const { Option } = Select

const SalesManagerDashboard = () => {
  const [teamStats, setTeamStats] = useState({
    totalTeamOffers: 0,
    approvedThisMonth: 0,
    pendingReview: 0,
    averageDiscount: 0,
    conversionRate: 0
  })
  
  const [offers, setOffers] = useState([])
  const [teamPerformance, setTeamPerformance] = useState([])
  const [selectedPeriod, setSelectedPeriod] = useState('month')

  useEffect(() => {
    fetchManagerDashboardData()
  }, [selectedPeriod])

  const fetchManagerDashboardData = async () => {
    try {
      const [statsRes, offersRes, performanceRes] = await Promise.all([
        fetch(`/api/dashboard/sales-manager/stats?period=${selectedPeriod}`).then(r => r.json()),
        fetch('/api/dashboard/sales-manager/offers').then(r => r.json()),
        fetch(`/api/dashboard/sales-manager/team-performance?period=${selectedPeriod}`).then(r => r.json())
      ])
      
      setTeamStats(statsRes.data)
      setOffers(offersRes.data)
      setTeamPerformance(performanceRes.data)
    } catch (error) {
      console.error('Failed to fetch manager dashboard data:', error)
    }
  }

  const offersColumns = [
    { title: 'Offer ID', dataIndex: 'id', key: 'id', width: 80 },
    { title: 'Property Consultant', dataIndex: 'sales_rep_name', key: 'salesRep' },
    { title: 'Customer', dataIndex: 'customer_name', key: 'customer' },
    { title: 'Unit', dataIndex: 'unit_code', key: 'unit' },
    { title: 'Amount', dataIndex: 'total_amount', key: 'amount', render: (amount) => `EGP ${amount?.toLocaleString()}` },
    { title: 'Discount %', dataIndex: 'discount_percent', key: 'discount', render: (discount) => `${discount}%` },
    { title: 'Status', dataIndex: 'status', key: 'status', render: (status) => {
      const colors = {
        'pending_sm': 'orange',
        'pending_fm': 'blue',
        'pending_tm': 'purple',
        'approved': 'green',
        'rejected': 'red'
      }
      return <Tag color={colors[status]}>{String(status).toUpperCase()}</Tag>
    }},
    { title: 'Submitted', dataIndex: 'created_at', key: 'submitted', render: (date) => new Date(date).toLocaleDateString() },
    { title: 'Action', key: 'action', render: (_, record) => (
      <Button size="small" type="primary" onClick={() => window.location.href = `/offers/${record.id}/review`}>
        Review
      </Button>
    )}
  ]

  const performanceColumns = [
    { title: 'Property Consultant', dataIndex: 'name', key: 'name' },
    { title: 'Total Offers', dataIndex: 'total_offers', key: 'totalOffers' },
    { title: 'Approved', dataIndex: 'approved_offers', key: 'approved' },
    { title: 'Conversion Rate', dataIndex: 'conversion_rate', key: 'conversionRate', render: (rate) => `${rate}%` },
    { title: 'Avg Discount', dataIndex: 'avg_discount', key: 'avgDiscount', render: (discount) => `${discount}%` },
    { title: 'Total Value', dataIndex: 'total_value', key: 'totalValue', render: (value) => `EGP ${value?.toLocaleString()}` },
    { title: 'Performance', dataIndex: 'performance_score', key: 'performance', render: (score) => {
      const color = score >= 80 ? 'green' : score >= 60 ? 'orange' : 'red'
      return <Tag color={color}>{score}%</Tag>
    }}
  ]

  return (
    <div className="sales-manager-dashboard">
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Team Offers" 
              value={teamStats.totalTeamOffers} 
              prefix={<TeamOutlined />}
              valueStyle={{ color: '#1890ff' }} 
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Approved This Month" 
              value={teamStats.approvedThisMonth} 
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }} 
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Pending Review" 
              value={teamStats.pendingReview} 
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14' }} 
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Avg Discount" 
              value={teamStats.averageDiscount} 
              suffix="%" 
              prefix={<DollarOutlined />}
              valueStyle={{ color: '#722ed1' }} 
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic 
              title="Conversion Rate" 
              value={teamStats.conversionRate} 
              suffix="%" 
              prefix={<TrendingUpOutlined />}
              valueStyle={{ color: '#13c2c2' }} 
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <div style={{ marginBottom: 8 }}>Period</div>
            <Select value={selectedPeriod} onChange={setSelectedPeriod} style={{ width: '100%' }}>
              <Option value="week">This Week</Option>
              <Option value="month">This Month</Option>
              <Option value="quarter">This Quarter</Option>
              <Option value="year">This Year</Option>
            </Select>
          </Card>
        </Col>
      </Row>

      <Tabs defaultActiveKey="offers">
        <Tabs.TabPane tab="Offer Review" key="offers">
          <Card 
            title="Offers Pending Review" 
            extra={
              <div>
                <RangePicker style={{ marginRight: 16 }} />
                <Button type="primary">Bulk Approve</Button>
              </div>
            }
          >
            <Table 
              dataSource={offers}
              columns={offersColumns}
              rowKey="id"
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </Tabs.TabPane>
        
        <Tabs.TabPane tab="Team Performance" key="performance">
          <Card title="Sales Team Performance Metrics">
            <Table 
              dataSource={teamPerformance}
              columns={performanceColumns}
              rowKey="id"
              pagination={false}
            />
          </Card>
        </Tabs.TabPane>
        
        <Tabs.TabPane tab="Blocking Overview" key="blocks">
          <Card title="Currently Blocked Units">
            {/* Block management component will be added here */}
          </Card>
        </Tabs.TabPane>
        
        <Tabs.TabPane tab="Analytics" key="analytics">
          <Row gutter={16}>
            <Col span={12}>
              <Card title="Discount Analysis">
                {/* Discount analysis charts */}
              </Card>
            </Col>
            <Col span={12}>
              <Card title="Sales Forecast">
                {/* Sales forecasting component */}
              </Card>
            </Col>
          </Row>
        </Tabs.TabPane>
      </Tabs>
    </div>
  )
}

export default SalesManagerDashboard